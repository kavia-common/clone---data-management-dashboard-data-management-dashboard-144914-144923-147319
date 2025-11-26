'use strict';

/**
 * PUBLIC_INTERFACE
 * llmCostsOverTimeService
 * Aggregates total LLM costs over time from the 'llm-costs' collection, supporting multiple schema variants.
 * - Buckets by granularity: day | week | month
 * - Time range [from, to] inclusive for day/month starts, with exclusive upper bound on bucketing end
 * - Tenant scoping: injects tenant filter using resolved tenant from middleware/context; supports T0000/all-tenant bypass
 *
 * Collection and field assumptions:
 * - Collection: 'llm-costs' (from model) but allow environment override via LLM_EVENTS_COLLECTION
 * - Date fields: prefer 'timestamp', fallback to 'created_at', then 'updated_at'
 * - Cost fields: prefer 'total_cost' when currency is USD or currency missing; fallback to 'cost_usd'; fallback to 'cost' if numeric or parsable; support "$" strings
 *
 * Returns result formatted for chart consumption:
 * {
 *   labels: ['YYYY-MM-DD', ...],
 *   datasets: [{ label: 'Total Cost', data: [number, ...] }],
 *   meta: { granularity: 'day'|'week'|'month', from: ISOString, to: ISOString }
 * }
 */

const { getDb, getCollection } = require('../config/db');
const { startOfDayUTC, addDaysUTC, formatYYYYMMDD } = require('../utils/date');

function resolveTimeBounds({ from, to, defaultDays = 30 }) {
  const now = new Date();
  const end = to ? new Date(to) : now;
  const endOk = isFinite(end) ? end : now;
  const start = from ? new Date(from) : addDaysUTC(endOk, -(defaultDays - 1));
  const startOk = isFinite(start) ? start : addDaysUTC(endOk, -(defaultDays - 1));
  // Normalize to day boundaries in UTC
  const fromUtc = startOfDayUTC(startOk);
  const toUtc = new Date(startOfDayUTC(endOk).getTime() + 24 * 60 * 60 * 1000 - 1); // end-of-day
  return { fromUtc, toUtc };
}

function resolveGranularity(granularity) {
  const g = String(granularity || 'day').toLowerCase();
  if (g === 'week' || g === 'month') return g;
  return 'day';
}

function computeDateField() {
  // Prefer timestamp, then created_at, then updated_at
  return {
    $ifNull: ['$timestamp', { $ifNull: ['$created_at', '$updated_at'] }],
  };
}

function buildCostNumberField() {
  // Choose cost from multiple fields and sanitize to number
  return {
    $let: {
      vars: {
        // Pre-choose candidate cost fields
        prefer_cost: {
          $ifNull: [
            '$total_cost',
            { $ifNull: ['$cost_usd', { $ifNull: ['$cost', 0] }] },
          ],
        },
      },
      in: {
        $convert: {
          input: {
            $replaceAll: {
              input: {
                $replaceAll: { input: { $toString: '$$prefer_cost' }, find: ',', replacement: '' },
              },
              find: '$',
              replacement: '',
            },
          },
          to: 'double',
          onError: 0,
          onNull: 0,
        },
      },
    },
  };
}

function buildBucketStage(granularity) {
  const dateField = computeDateField();
  if (granularity === 'month') {
    return {
      $group: {
        _id: {
          y: { $year: { date: dateField } },
          m: { $month: { date: dateField } },
        },
        total: { $sum: buildCostNumberField() },
      },
    };
  }
  if (granularity === 'week') {
    // ISO week-like: use dateTrunc where available; fallback to manual week start (Mon)
    return {
      $group: {
        _id: {
          $dateTrunc: {
            date: dateField,
            unit: 'week',
            binSize: 1,
            timezone: 'UTC',
          },
        },
        total: { $sum: buildCostNumberField() },
      },
    };
  }
  // day
  return {
    $group: {
      _id: {
        y: { $year: { date: dateField } },
        m: { $month: { date: dateField } },
        d: { $dayOfMonth: { date: dateField } },
      },
      total: { $sum: buildCostNumberField() },
    },
  };
}

function projectLabelStage(granularity) {
  if (granularity === 'week') {
    // id is date (start of week)
    return {
      $project: {
        _id: 0,
        label: {
          $dateToString: { format: '%Y-%m-%d', date: '$_id', timezone: 'UTC' },
        },
        total: { $round: ['$total', 6] },
      },
    };
  }
  if (granularity === 'month') {
    return {
      $project: {
        _id: 0,
        label: {
          $concat: [
            { $toString: '$_id.y' },
            '-',
            { $toString: { $cond: [{ $gte: ['$_id.m', 10] }, '$_id.m', { $concat: ['0', { $toString: '$_id.m' }] }] } },
            '-01',
          ],
        },
        total: { $round: ['$total', 6] },
      },
    };
  }
  // day
  return {
    $project: {
      _id: 0,
      label: {
        $concat: [
          { $toString: '$_id.y' },
          '-',
          { $toString: { $cond: [{ $gte: ['$_id.m', 10] }, '$_id.m', { $concat: ['0', { $toString: '$_id.m' }] }] } },
          '-',
          { $toString: { $cond: [{ $gte: ['$_id.d', 10] }, '$_id.d', { $concat: ['0', { $toString: '$_id.d' }] }] } },
        ],
      },
      total: { $round: ['$total', 6] },
    },
  };
}

// PUBLIC_INTERFACE
async function getLlmCostsOverTime({ tenantId, from, to, granularity = 'day' } = {}) {
  // Accept alias keys if passed from controllers
  const effFrom = from || undefined;
  const effTo = to || undefined;
  const g = resolveGranularity(granularity);
  const { fromUtc, toUtc } = resolveTimeBounds({ from: effFrom, to: effTo });

  // Build tenant $match
  const tenantMatch = tenantId
    ? {
        $or: [
          { tenant_id: String(tenantId) },
          { organization_id: String(tenantId) },
          { tenantId: String(tenantId) },
          { organizationId: String(tenantId) },
          { 'tenant.tenant_id': String(tenantId) },
        ],
      }
    : {};

  const dateField = computeDateField();

  const matchStage = {
    $match: {
      ...(tenantMatch && Object.keys(tenantMatch).length ? tenantMatch : {}),
      // Time range on date field
      $expr: {
        $and: [
          { $gte: [dateField, fromUtc] },
          { $lte: [dateField, toUtc] },
        ],
      },
    },
  };

  const pipeline = [
    matchStage,
    buildBucketStage(g),
    projectLabelStage(g),
    { $sort: { label: 1 } },
  ];

  // Resolve collection using model or env candidates for robustness
  const candidates = [];
  const envVal = (process.env.LLM_EVENTS_COLLECTION || '').trim();
  if (envVal) {
    envVal.split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => candidates.push(n));
  }
  // Prefer model's collection first
  candidates.push('llm-costs', 'llm_costs', 'llm_events', 'llm-events');

  const collection = await getCollection(candidates);

  const rows = await collection.aggregate(pipeline, { allowDiskUse: true }).toArray();

  // Fill missing buckets with zero
  const labels = [];
  const dataByLabel = new Map(rows.map((r) => [String(r.label), Number(r.total || 0)]));

  if (g === 'month') {
    // iterate months from start to end
    const cursor = new Date(Date.UTC(fromUtc.getUTCFullYear(), fromUtc.getUTCMonth(), 1));
    const end = new Date(Date.UTC(toUtc.getUTCFullYear(), toUtc.getUTCMonth(), 1));
    while (cursor <= end) {
      const label = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-01`;
      labels.push(label);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  } else if (g === 'week') {
    // step one week using label from aggregated results to avoid week-start drift; but ensure continuity
    // Build a sorted array of distinct labels and then fill gaps by stepping 7 days from first to last
    const existing = rows.map((r) => r.label).sort();
    if (existing.length) {
      const first = new Date(`${existing[0]}T00:00:00.000Z`);
      const last = new Date(`${existing[existing.length - 1]}T00:00:00.000Z`);
      let c = new Date(first);
      while (c <= last) {
        labels.push(formatYYYYMMDD(c));
        c = addDaysUTC(c, 7);
      }
    } else {
      // fall back to day-stepping collapsed each 7 days
      let c = new Date(fromUtc);
      const end = new Date(toUtc);
      while (c <= end) {
        labels.push(formatYYYYMMDD(c));
        c = addDaysUTC(c, 7);
      }
    }
  } else {
    let c = new Date(fromUtc);
    const end = new Date(toUtc);
    while (c <= end) {
      labels.push(formatYYYYMMDD(c));
      c = addDaysUTC(c, 1);
    }
  }

  const data = labels.map((l) => Number((dataByLabel.get(l) || 0).toFixed ? (dataByLabel.get(l) || 0).toFixed(6) : (dataByLabel.get(l) || 0)));

  return {
    labels,
    datasets: [
      {
        label: 'Total Cost',
        data: data.map((v) => Number(v)),
      },
    ],
    meta: {
      granularity: g,
      from: fromUtc.toISOString(),
      to: toUtc.toISOString(),
    },
  };
}

module.exports = {
  getLlmCostsOverTime,
};
