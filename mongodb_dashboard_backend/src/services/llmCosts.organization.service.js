'use strict';

/**
 * Service: Organization-level LLM costs aggregation
 * Aggregates per organization (tenant) total cost and nests users with per-user and per-project totals.
 * Pagination applies to the flattened user rows (top-level array in response).
 *
 * Performance:
 * - Uses covered indexes: { tenant_id:1, timestamp:-1, _id:1 } or { organization_id:1, timestamp:-1, _id:1 }
 * - allowDiskUse(true), maxTimeMS(4000)
 * - Projections and numeric coercion for cost fields
 */

const { getDb } = require('../config/db');

/**
 * Normalize a potentially currency-formatted value to a number (double).
 * Ensures we never use a bare '$' in any expression to prevent Mongo 16872.
 */
function normalizeCurrencyToDoubleExpr(pathExpr) {
  return {
    $let: {
      vars: {
        raw: { $ifNull: [pathExpr, 0] },
      },
      in: {
        $convert: {
          input: {
            $cond: [
              { $isNumber: '$$raw' },
              '$$raw',
              {
                $cond: [
                  {
                    $and: [
                      { $eq: [{ $type: '$$raw' }, 'string'] },
                      { $eq: [{ $substrCP: ['$$raw', 0, 1] }, '$'] },
                    ],
                  },
                  { $substrCP: ['$$raw', 1, { $strLenCP: '$$raw' }] },
                  { $toString: '$$raw' },
                ],
              },
            ],
          },
          to: 'double',
          onError: 0,
          onNull: 0,
        },
      },
    },
  };
}

/**
 * INTERNAL: Build a normalized $match filter for tenant/organization scope plus optional time window.
 */
function buildTenantAndTimeFilter({ tenantId, filter = {}, from, to }) {
  const f = filter && typeof filter === 'object' ? { ...filter } : {};

  // strip tenant fields from client-provided filter
  delete f.tenant_id;
  delete f.tenantId;
  delete f.organization_id;
  delete f.organizationId;
  delete f.orgId;

  // optional time window on timestamp; do not require from/to
  let timeFilter = null;
  if (from || to) {
    let fromDate = from ? new Date(from) : null;
    let toDate = to ? new Date(to) : null;
    if (from && isNaN(fromDate.getTime())) fromDate = null;
    if (to && isNaN(toDate.getTime())) toDate = null;

    const range = {};
    if (fromDate) range.$gte = fromDate;
    if (toDate) range.$lte = toDate;

    if (Object.keys(range).length) {
      timeFilter = { timestamp: range };
    }
  }

  let base = f;
  if (tenantId) {
    const orgFilter = {
      $or: [
        { tenant_id: String(tenantId) },
        { organization_id: String(tenantId) },
        { organizationId: String(tenantId) },
        { tenantId: String(tenantId) },
        { orgId: String(tenantId) },
        { 'tenant.tenant_id': String(tenantId) },
      ],
    };
    base = Object.keys(base).length ? { $and: [base, orgFilter] } : orgFilter;
  }

  if (timeFilter) {
    return Object.keys(base).length ? { $and: [base, timeFilter] } : timeFilter;
  }
  return base;
}

/**
 * INTERNAL: Numeric coercion for cost fields as robust as possible.
 * Converts known shapes to a numeric double.
 */
function numericCostExpr() {
  return {
    $let: {
      vars: {
        raw: {
          $ifNull: [
            '$total_cost',
            {
              $ifNull: [
                '$cost',
                { $ifNull: ['$usage.cost', 0] },
              ],
            },
          ],
        },
      },
      in: {
        $convert: {
          input: {
            $cond: [
              { $isNumber: '$$raw' }, '$$raw',
              {
                $cond: [
                  { $and: [{ $eq: [{ $type: '$$raw' }, 'string'] }, { $eq: [{ $substrCP: ['$$raw', 0, 1] }, '$'] }] },
                  { $substrCP: ['$$raw', 1, { $strLenCP: '$$raw' }] },
                  { $toString: '$$raw' },
                ],
              },
            ],
          },
          to: 'double',
          onError: 0,
          onNull: 0,
        },
      },
    },
  };
}

/**
 * PUBLIC_INTERFACE
 * aggregateOrganizationCosts
 * Computes:
 *  - organization_cost (sum of numeric cost) for the scoped organization (or all-tenants if bypassed at controller)
 *  - users: [{ user_id, type, user_cost, projects: [{ project_id, project_cost }], project_count }]
 * Applies pagination on the users array based on page/limit. Also returns total user rows for meta.total.
 */
async function aggregateOrganizationCosts({ tenantId, page = 1, limit = 20, from, to, filter = {} } = {}) {
  const db = await getDb();
  const stageLog = []; // capture stage-by-stage context for debugging

  // Helper to push stage info safely
  const pushStage = (name, details) => {
    try { stageLog.push({ name, at: new Date().toISOString(), ...details }); } catch (_) {}
  };

  // Prefer primary collection name 'llm-costs' and fallback to 'llm_costs' if needed
  let col;
  try {
    col = db.collection('llm-costs');
    pushStage('collection', { name: 'llm-costs' });
  } catch (e1) {
    pushStage('collection_error_llm-costs', { error: e1?.message || String(e1) });
    col = undefined;
  }
  if (!col) {
    try {
      col = db.collection('llm_costs');
      pushStage('collection', { name: 'llm_costs' });
    } catch (e2) {
      pushStage('collection_error_llm_costs', { error: e2?.message || String(e2) });
      try {
        col = db.collection('llm_events'); // read-only analytics shape
        pushStage('collection', { name: 'llm_events' });
      } catch (e3) {
        pushStage('collection_error_llm_events', { error: e3?.message || String(e3) });
      }
    }
  }

  if (!col) {
    pushStage('fatal_no_collection', {});
    // PUBLIC_INTERFACE
    return {
      // minimal empty envelope-like object for callers
      _id: tenantId ? String(tenantId) : 'all-tenants',
      organization_id: tenantId ? String(tenantId) : 'all-tenants',
      organization_cost: 0,
      users: [],
      totalUsers: 0,
      meta_debug: { stageLog },
    };
  }

  const match = buildTenantAndTimeFilter({ tenantId, filter, from, to });
  pushStage('match_built', { match });

  // Pipeline to compute:
  // - per project totals -> per user totals including projects array
  // - organization-level total cost
  const pipeline = [
    { $match: match || {} },
    { $addFields: { timestamp: { $ifNull: ['$timestamp', '$created_at'] } } },
    {
      $project: {
        _id: 0,
        user_id: { $toString: { $ifNull: ['$user_id', { $ifNull: ['$userId', '$user'] }] } },
        project_id: {
          $toString: {
            $ifNull: ['$project_id', { $ifNull: ['$projectId', { $ifNull: ['$project', '$project_code'] }] }],
          },
        },
        organization_id: {
          $toString: {
            $ifNull: [
              '$tenant_id',
              { $ifNull: ['$organization_id', { $ifNull: ['$organizationId', { $ifNull: ['$tenantId', '$orgId'] }] }] },
            ],
          },
        },
        type: { $literal: 'llm_interaction' },
        numeric_cost: numericCostExpr(),
      },
    },
    {
      $match: {
        user_id: { $ne: null },
        project_id: { $ne: null },
      },
    },
    {
      $group: {
        _id: { user_id: '$user_id', project_id: '$project_id' },
        project_cost: { $sum: '$numeric_cost' },
        any_org: { $first: '$organization_id' },
      },
    },
    {
      $project: {
        _id: 0,
        user_id: '$_id.user_id',
        project_id: '$_id.project_id',
        project_cost: { $round: ['$project_cost', 6] },
        organization_id: '$any_org',
      },
    },
    {
      $group: {
        _id: { user_id: '$user_id', organization_id: '$organization_id' },
        user_cost: { $sum: '$project_cost' },
        projects: { $push: { project_id: '$project_id', project_cost: '$project_cost' } },
      },
    },
    {
      $project: {
        _id: 0,
        user_id: '$_id.user_id',
        organization_id: '$_id.organization_id',
        type: { $literal: 'llm_interaction' },
        user_cost: { $round: ['$user_cost', 6] },
        project_count: { $size: '$projects' },
        projects: 1,
      },
    },
  ];
  pushStage('user_pipeline_ready', { length: pipeline.length });

  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.max(parseInt(limit, 10) || 20, 1);
  const clampedLimit = safeLimit > 100 ? 100 : safeLimit;
  const skipCount = (safePage - 1) * clampedLimit;

  // Use $facet; NOTE: $sortArray requires MongoDB 5.2+. If server < 5.2, it will throw.
  const facetPipeline = [
    { $match: match || {} },
    { $addFields: { timestamp: { $ifNull: ['$timestamp', '$created_at'] } } },
    {
      $facet: {
        orgTotal: [
          {
            $group: {
              _id: null,
              organization_cost: { $sum: numericCostExpr() },
              organization_id: {
                $first: {
                  $toString: {
                    $ifNull: [
                      '$tenant_id',
                      { $ifNull: ['$organization_id', { $ifNull: ['$organizationId', { $ifNull: ['$tenantId', '$orgId'] }] }] },
                    ],
                  },
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              organization_cost: { $round: ['$organization_cost', 6] },
              organization_id: 1,
            },
          },
        ],
        userProjects: pipeline,
      },
    },
    {
      $project: {
        orgTotal: { $arrayElemAt: ['$orgTotal', 0] },
        usersSorted: {
          $sortArray: {
            input: { $ifNull: ['$userProjects', []] },
            sortBy: { user_cost: -1, user_id: 1 },
          },
        },
      },
    },
    {
      $project: {
        orgTotal: 1,
        totalUsers: { $size: { $ifNull: ['$usersSorted', []] } },
        users: { $slice: [{ $ifNull: ['$usersSorted', []] }, skipCount, clampedLimit] },
      },
    },
  ];
  pushStage('facet_pipeline_ready', { length: facetPipeline.length, page: safePage, limit: clampedLimit, skip: skipCount });

  let docs = [];
  try {
    const agg = col.aggregate(facetPipeline, { allowDiskUse: true, maxTimeMS: 4000 });
    // Apply covered index hint when possible
    try {
      const mstr = JSON.stringify(match || {});
      const usesOrgInMatch = mstr.includes('"organization_id"') || mstr.includes('"organizationId"');
      const usesTenantInMatch = mstr.includes('"tenant_id"') || mstr.includes('"tenantId"');
      if (usesOrgInMatch) {
        agg.hint({ organization_id: 1, timestamp: -1, _id: 1 });
        pushStage('hint_applied', { hint: { organization_id: 1, timestamp: -1, _id: 1 } });
      } else if (usesTenantInMatch) {
        agg.hint({ tenant_id: 1, timestamp: -1, _id: 1 });
        pushStage('hint_applied', { hint: { tenant_id: 1, timestamp: -1, _id: 1 } });
      } else {
        agg.hint({ timestamp: -1, _id: 1 });
        pushStage('hint_applied', { hint: { timestamp: -1, _id: 1 } });
      }
    } catch (eHint) {
      pushStage('hint_error', { error: eHint?.message || String(eHint) });
    }
    docs = await agg.toArray();
    pushStage('aggregation_completed', { docs: docs?.length || 0 });
  } catch (e) {
    pushStage('aggregation_failed', { error: e?.message || String(e) });
    // PUBLIC_INTERFACE
    return {
      _id: tenantId ? String(tenantId) : 'all-tenants',
      organization_id: tenantId ? String(tenantId) : 'all-tenants',
      organization_cost: 0,
      users: [],
      totalUsers: 0,
      meta_debug: { stageLog },
    };
  }

  const first = docs && docs[0] ? docs[0] : { orgTotal: null, users: [], totalUsers: 0 };
  const orgTotal = first.orgTotal || { organization_cost: 0, organization_id: tenantId ? String(tenantId) : null };
  const shaped = {
    _id: orgTotal.organization_id || (tenantId ? String(tenantId) : 'all-tenants'),
    organization_id: orgTotal.organization_id || (tenantId ? String(tenantId) : 'all-tenants'),
    organization_cost: Number(orgTotal.organization_cost || 0),
    users: Array.isArray(first.users)
      ? first.users.map((u) => ({
          user_id: u.user_id,
          type: 'llm_interaction',
          user_cost: Number(u.user_cost || 0),
          project_count: Number(u.project_count || (Array.isArray(u.projects) ? u.projects.length : 0)),
          projects: Array.isArray(u.projects)
            ? u.projects.map((p) => ({ project_id: p.project_id, project_cost: Number(p.project_cost || 0) }))
            : [],
        }))
      : [],
    totalUsers: Number(first.totalUsers || 0),
  };
  pushStage('shape_done', { totalUsers: shaped.totalUsers, organization_cost: shaped.organization_cost });

  return { ...shaped, meta_debug: { stageLog } };
}

module.exports = {
  // PUBLIC_INTERFACE
  aggregateOrganizationCosts,
};
