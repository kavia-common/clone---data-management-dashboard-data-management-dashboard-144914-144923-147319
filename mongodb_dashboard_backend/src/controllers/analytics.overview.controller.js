'use strict';

const { getDb, isDbConnected } = require('../config/db');
const { startOfDayUTC, addDaysUTC, formatYYYYMMDD } = require('../utils/date');

/**
 * PUBLIC_INTERFACE
 * computeOverviewAnalytics
 * Controller for GET /api/analytics/overview
 *
 * Query params:
 * - range: 7d | 30d | 12w | 12m
 * - metric: sessions | activeUsers | deployments | errorRate | llmCost (optional selector for series; default sessions)
 *
 * Response:
 *  {
 *    kpis: { activeUsers, sessions, deploySuccessRate, errorRate, totalLlmCost, avgCostPerSession },
 *    series: [{ t, sessions, activeUsers?, deployments?, errorRate?, llmCost? }],
 *    meta: { bucket, range }
 *  }
 *
 * Notes:
 * - Computes KPIs from existing collections when available:
 *   - session_tracking: counts sessions in range (by session_start or last_updated), distinct active users, errorRate from status=failed.
 *   - app_deployments: deploySuccessRate = successes/total in range (status success/failed).
 *   - llm_costs: sum total_cost for range; avgCostPerSession = totalCost / max(1, sessionsRangeCount)
 * - If DB is not connected or collections are absent, responds with zeros and a zero-filled time series.
 */
async function computeOverviewAnalytics(req, res) {
  try {
    const { range = '30d', metric = 'sessions' } = req.query;

    // Validate/normalize inputs
    const validRanges = new Set(['7d', '30d', '12w', '12m']);
    const normRange = validRanges.has(range) ? range : '30d';

    // Resolve start-end based on range
    const now = new Date();
    let start = new Date(now);
    if (normRange === '7d') {
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (normRange === '30d') {
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (normRange === '12w') {
      start = new Date(now.getTime() - 12 * 7 * 24 * 60 * 60 * 1000);
    } else if (normRange === '12m') {
      // Approximate 12 months as 365 days
      start = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    }

    // Bucket selection from range
    let bucket = 'daily';
    let stepDays = 1;
    if (normRange === '12w') {
      bucket = 'weekly';
      stepDays = 7;
    } else if (normRange === '12m') {
      bucket = 'monthly';
      stepDays = 30; // approximate monthly
    }

    const periodStart = startOfDayUTC(start);
    const periodEnd = startOfDayUTC(now);

    // Helper: build empty series timeline keys
    const buildEmptySeries = () => {
      const points = [];
      let cursor = new Date(periodStart);
      while (cursor <= periodEnd) {
        let t;
        if (bucket === 'daily') {
          t = formatYYYYMMDD(cursor);
        } else if (bucket === 'weekly') {
          const y = cursor.getUTCFullYear();
          const startOfYear = new Date(Date.UTC(y, 0, 1));
          const diffDays = Math.floor((cursor - startOfYear) / (24 * 60 * 60 * 1000)) + 1;
          const w = Math.max(1, Math.min(53, Math.ceil(diffDays / 7)));
          t = `${String(y).padStart(4, '0')}-W${String(w).padStart(2, '0')}`;
        } else {
          const y = cursor.getUTCFullYear();
          const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
          t = `${String(y).padStart(4, '0')}-${m}`;
        }
        points.push({ t, sessions: 0, activeUsers: 0, deployments: 0, errorRate: 0, llmCost: 0 });
        cursor = addDaysUTC(cursor, stepDays);
      }
      return points;
    };

    // If DB not connected, return empty series and zero KPIs
    if (!isDbConnected()) {
      return res.status(200).json({
        kpis: {
          activeUsers: 0,
          sessions: 0,
          deploySuccessRate: 0,
          errorRate: 0,
          totalLlmCost: 0,
          avgCostPerSession: 0,
        },
        series: buildEmptySeries(),
        meta: { bucket, range: normRange },
      });
    }

    const db = await getDb();
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    const names = new Set(collections.map((c) => c.name));

    const hasSessions = names.has('session_tracking');
    const hasDeployments = names.has('app_deployments');
    const hasLlmCosts = names.has('llm_costs');

    // Aggregations with graceful fallbacks
    let sessionsTotal = 0;
    let errorSessions = 0;
    let uniqueUsers = 0;
    let deployTotal = 0;
    let deploySuccess = 0;
    let totalLlmCost = 0;

    const dateUpperInclusive = new Date(periodEnd.getTime() + 24 * 60 * 60 * 1000 - 1);

    // Sessions + Active Users + Error Rate
    if (hasSessions) {
      const col = db.collection('session_tracking');

      // Count sessions by bucket and distinct users by bucket
      // Build base match
      const match = {
        $and: [
          {
            $or: [
              { session_start: { $gte: periodStart, $lte: dateUpperInclusive } },
              { last_updated: { $gte: periodStart, $lte: dateUpperInclusive } },
              { created_at: { $gte: periodStart, $lte: dateUpperInclusive } },
            ],
          },
        ],
      };

      // Total sessions in range
      sessionsTotal = await col.countDocuments(match).catch(() => 0);

      // Error sessions in range
      errorSessions = await col.countDocuments({ ...match, status: 'failed' }).catch(() => 0);

      // Distinct active users in range
      const userIds = await col.distinct('user_id', match).catch(() => []);
      uniqueUsers = Array.isArray(userIds) ? userIds.length : 0;
    }

    // Deployments success rate
    if (hasDeployments) {
      const col = db.collection('app_deployments');
      const match = { created_at: { $gte: periodStart, $lte: dateUpperInclusive } };
      deployTotal = await col.countDocuments(match).catch(() => 0);
      deploySuccess = await col.countDocuments({ ...match, status: 'success' }).catch(() => 0);
    }

    // LLM total costs
    if (hasLlmCosts) {
      const col = db.collection('llm_costs');
      const match = {
        $or: [
          { timestamp: { $gte: periodStart, $lte: dateUpperInclusive } },
          { created_at: { $gte: periodStart, $lte: dateUpperInclusive } },
        ],
      };
      const agg = await col
        .aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: '$total_cost' } } }])
        .toArray()
        .catch(() => []);
      totalLlmCost = agg?.[0]?.total || 0;
    }

    const errorRate = sessionsTotal > 0 ? errorSessions / sessionsTotal : 0;
    const deploySuccessRate = deployTotal > 0 ? deploySuccess / deployTotal : 0;
    const avgCostPerSession = sessionsTotal > 0 ? totalLlmCost / sessionsTotal : 0;

    // Build time series keyed map for buckets
    const seriesMap = new Map();
    for (const pt of buildEmptySeries()) {
      seriesMap.set(pt.t, { ...pt });
    }

    // Fill series from collections when available
    // Sessions per bucket
    if (hasSessions) {
      const col = db.collection('session_tracking');
      // Determine date field preference
      const dateField = 'last_updated';
      const match = {
        [dateField]: { $gte: periodStart, $lte: dateUpperInclusive },
      };

      let idExpr;
      if (bucket === 'daily') {
        idExpr = {
          y: { $year: { date: `$${dateField}`, timezone: 'UTC' } },
          m: { $month: { date: `$${dateField}`, timezone: 'UTC' } },
          d: { $dayOfMonth: { date: `$${dateField}`, timezone: 'UTC' } },
        };
      } else if (bucket === 'weekly') {
        idExpr = {
          y: { $year: { date: `$${dateField}`, timezone: 'UTC' } },
          w: { $week: { date: `$${dateField}`, timezone: 'UTC' } },
        };
      } else {
        idExpr = {
          y: { $year: { date: `$${dateField}`, timezone: 'UTC' } },
          m: { $month: { date: `$${dateField}`, timezone: 'UTC' } },
        };
      }

      const sessAgg = await col
        .aggregate([
          { $match: match },
          { $group: { _id: idExpr, count: { $sum: 1 }, users: { $addToSet: '$user_id' } } },
          { $sort: { '_id.y': 1, '_id.m': 1, '_id.w': 1, '_id.d': 1 } },
        ])
        .toArray()
        .catch(() => []);

      for (const r of sessAgg) {
        let key;
        if (bucket === 'daily') {
          key = `${String(r._id.y).padStart(4, '0')}-${String(r._id.m).padStart(2, '0')}-${String(r._id.d).padStart(2, '0')}`;
        } else if (bucket === 'weekly') {
          key = `${String(r._id.y).padStart(4, '0')}-W${String(r._id.w).padStart(2, '0')}`;
        } else {
          key = `${String(r._id.y).padStart(4, '0')}-${String(r._id.m).padStart(2, '0')}`;
        }
        const curr = seriesMap.get(key) || { t: key };
        curr.sessions = (curr.sessions || 0) + (r.count || 0);
        curr.activeUsers = (curr.activeUsers || 0) + (Array.isArray(r.users) ? r.users.length : 0);
        seriesMap.set(key, curr);
      }

      // Error rate per bucket (failed / total)
      const errAgg = await col
        .aggregate([
          { $match: match },
          {
            $group: {
              _id: idExpr,
              total: { $sum: 1 },
              failed: {
                $sum: {
                  $cond: [{ $eq: ['$status', 'failed'] }, 1, 0],
                },
              },
            },
          },
          { $sort: { '_id.y': 1, '_id.m': 1, '_id.w': 1, '_id.d': 1 } },
        ])
        .toArray()
        .catch(() => []);
      for (const r of errAgg) {
        let key;
        if (bucket === 'daily') {
          key = `${String(r._id.y).padStart(4, '0')}-${String(r._id.m).padStart(2, '0')}-${String(r._id.d).padStart(2, '0')}`;
        } else if (bucket === 'weekly') {
          key = `${String(r._id.y).padStart(4, '0')}-W${String(r._id.w).padStart(2, '0')}`;
        } else {
          key = `${String(r._id.y).padStart(4, '0')}-${String(r._id.m).padStart(2, '0')}`;
        }
        const curr = seriesMap.get(key) || { t: key };
        const total = r.total || 0;
        const failed = r.failed || 0;
        curr.errorRate = total > 0 ? failed / total : 0;
        seriesMap.set(key, curr);
      }
    }

    // Deployments per bucket and success rate (optional)
    if (hasDeployments) {
      const col = db.collection('app_deployments');
      const dateField = 'created_at';
      const match = {
        [dateField]: { $gte: periodStart, $lte: dateUpperInclusive },
      };
      let idExpr;
      if (bucket === 'daily') {
        idExpr = {
          y: { $year: { date: `$${dateField}`, timezone: 'UTC' } },
          m: { $month: { date: `$${dateField}`, timezone: 'UTC' } },
          d: { $dayOfMonth: { date: `$${dateField}`, timezone: 'UTC' } },
        };
      } else if (bucket === 'weekly') {
        idExpr = {
          y: { $year: { date: `$${dateField}`, timezone: 'UTC' } },
          w: { $week: { date: `$${dateField}`, timezone: 'UTC' } },
        };
      } else {
        idExpr = {
          y: { $year: { date: `$${dateField}`, timezone: 'UTC' } },
          m: { $month: { date: `$${dateField}`, timezone: 'UTC' } },
        };
      }

      const depAgg = await col
        .aggregate([
          { $match: match },
          {
            $group: {
              _id: idExpr,
              total: { $sum: 1 },
              success: {
                $sum: {
                  $cond: [{ $eq: ['$status', 'success'] }, 1, 0],
                },
              },
            },
          },
          { $sort: { '_id.y': 1, '_id.m': 1, '_id.w': 1, '_id.d': 1 } },
        ])
        .toArray()
        .catch(() => []);

      for (const r of depAgg) {
        let key;
        if (bucket === 'daily') {
          key = `${String(r._id.y).padStart(4, '0')}-${String(r._id.m).padStart(2, '0')}-${String(r._id.d).padStart(2, '0')}`;
        } else if (bucket === 'weekly') {
          key = `${String(r._id.y).padStart(4, '0')}-W${String(r._id.w).padStart(2, '0')}`;
        } else {
          key = `${String(r._id.y).padStart(4, '0')}-${String(r._id.m).padStart(2, '0')}`;
        }
        const curr = seriesMap.get(key) || { t: key };
        curr.deployments = (curr.deployments || 0) + (r.total || 0);
        // We keep success rate only as KPI; per-point success rate is optional and omitted for simplicity
        seriesMap.set(key, curr);
      }
    }

    // LLM Cost per bucket (sum)
    if (hasLlmCosts) {
      const col = db.collection('llm_costs');
      const dateField = 'timestamp';
      const match = {
        $or: [
          { [dateField]: { $gte: periodStart, $lte: dateUpperInclusive } },
          { created_at: { $gte: periodStart, $lte: dateUpperInclusive } },
        ],
      };
      let idExpr;
      if (bucket === 'daily') {
        idExpr = {
          y: { $year: { date: `$${dateField}`, timezone: 'UTC' } },
          m: { $month: { date: `$${dateField}`, timezone: 'UTC' } },
          d: { $dayOfMonth: { date: `$${dateField}`, timezone: 'UTC' } },
        };
      } else if (bucket === 'weekly') {
        idExpr = {
          y: { $year: { date: `$${dateField}`, timezone: 'UTC' } },
          w: { $week: { date: `$${dateField}`, timezone: 'UTC' } },
        };
      } else {
        idExpr = {
          y: { $year: { date: `$${dateField}`, timezone: 'UTC' } },
          m: { $month: { date: `$${dateField}`, timezone: 'UTC' } },
        };
      }
      const costAgg = await col
        .aggregate([
          { $match: match },
          { $group: { _id: idExpr, total: { $sum: '$total_cost' } } },
          { $sort: { '_id.y': 1, '_id.m': 1, '_id.w': 1, '_id.d': 1 } },
        ])
        .toArray()
        .catch(() => []);
      for (const r of costAgg) {
        let key;
        if (bucket === 'daily') {
          key = `${String(r._id.y).padStart(4, '0')}-${String(r._id.m).padStart(2, '0')}-${String(r._id.d).padStart(2, '0')}`;
        } else if (bucket === 'weekly') {
          key = `${String(r._id.y).padStart(4, '0')}-W${String(r._id.w).padStart(2, '0')}`;
        } else {
          key = `${String(r._id.y).padStart(4, '0')}-${String(r._id.m).padStart(2, '0')}`;
        }
        const curr = seriesMap.get(key) || { t: key };
        curr.llmCost = (curr.llmCost || 0) + (r.total || 0);
        seriesMap.set(key, curr);
      }
    }

    const series = Array.from(seriesMap.values());

    return res.status(200).json({
      kpis: {
        activeUsers: uniqueUsers,
        sessions: sessionsTotal,
        deploySuccessRate,
        errorRate,
        totalLlmCost,
        avgCostPerSession,
      },
      series,
      meta: { range: normRange, bucket },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[analytics.overview] error:', err?.message || err);
    // Fallback with safe zeros
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const series = [];
    let cursor = startOfDayUTC(start);
    const end = startOfDayUTC(now);
    while (cursor <= end) {
      series.push({ t: formatYYYYMMDD(cursor), sessions: 0, activeUsers: 0, deployments: 0, errorRate: 0, llmCost: 0 });
      cursor = addDaysUTC(cursor, 1);
    }
    return res.status(200).json({
      kpis: {
        activeUsers: 0,
        sessions: 0,
        deploySuccessRate: 0,
        errorRate: 0,
        totalLlmCost: 0,
        avgCostPerSession: 0,
      },
      series,
      meta: { bucket: 'daily', range: '30d' },
    });
  }
}

module.exports = { computeOverviewAnalytics };
