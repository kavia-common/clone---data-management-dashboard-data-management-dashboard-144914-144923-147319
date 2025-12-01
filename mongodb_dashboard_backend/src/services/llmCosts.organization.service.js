'use strict';

/**
 * Service: Organization-level LLM costs aggregation (safe/minimal)
 * Provides a robust per-tenant aggregation with strict numeric coercion and simple stages to avoid Mongo 16872.
 * Returns flat, paginated user rows and organization total.
 *
 * Performance:
 * - Hints: { organization_id:1, timestamp:-1, _id:1 } or { tenant_id:1, timestamp:-1, _id:1 }
 * - allowDiskUse(true), maxTimeMS(4000)
 * - limit clamped to <= 100
 */

const { getDb } = require('../config/db');

/**
 * INTERNAL: Build match for tenant (organization_id or tenant_id) plus optional timestamp window.
 * Strips any client-provided tenant keys from filter.
 */
function buildTenantAndTimeFilter({ tenantId, filter = {}, from, to }) {
  const f = filter && typeof filter === 'object' ? { ...filter } : {};

  delete f.tenant_id;
  delete f.tenantId;
  delete f.organization_id;
  delete f.organizationId;
  delete f.orgId;

  let timeFilter = null;
  if (from || to) {
    let fromDate = from ? new Date(from) : null;
    let toDate = to ? new Date(to) : null;
    if (from && isNaN(fromDate?.getTime?.())) fromDate = null;
    if (to && isNaN(toDate?.getTime?.())) toDate = null;

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
  return base || {};
}

/**
 * INTERNAL: Robust numeric cost expression without any bare '$'.
 * Tries total_cost, then cost, then usage.cost; strips leading '$' from strings and converts to double.
 */
function numericCostExpr() {
  return {
    $let: {
      vars: {
        raw: {
          $ifNull: [
            '$total_cost',
            { $ifNull: ['$cost', { $ifNull: ['$usage.cost', 0] }] },
          ],
        },
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
 * PUBLIC_INTERFACE
 * aggregateOrganizationCosts
 * Computes:
 *  - organization_cost (sum of numeric costs)
 *  - per-user totals with project counts
 * Returns: { organization_id, organization_cost, users:[{ user_id, user_cost, projects_count }], totalUsers, meta_debug }
 */
async function aggregateOrganizationCosts({ tenantId, page = 1, limit = 20, from, to, filter = {} } = {}) {
  const db = await getDb();
  const stageLog = [];
  const log = (name, extra) => { try { stageLog.push({ name, at: new Date().toISOString(), ...(extra || {}) }); } catch (_) {} };

  // Select collection with fallbacks
  let col = null;
  try { col = db.collection('llm-costs'); log('collection', { name: 'llm-costs' }); } catch (e) { log('collection_error', { e: e?.message }); }
  if (!col) { try { col = db.collection('llm_costs'); log('collection', { name: 'llm_costs' }); } catch (e) { log('collection_error', { e: e?.message }); } }
  if (!col) { try { col = db.collection('llm_events'); log('collection', { name: 'llm_events' }); } catch (e) { log('collection_error', { e: e?.message }); } }

  if (!col) {
    log('fatal_no_collection', {});
    return {
      _id: tenantId ? String(tenantId) : 'all-tenants',
      organization_id: tenantId ? String(tenantId) : 'all-tenants',
      organization_cost: 0,
      users: [],
      totalUsers: 0,
      meta_debug: { stageLog },
    };
  }

  const match = buildTenantAndTimeFilter({ tenantId, filter, from, to });
  log('match_built', { match });

  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.max(parseInt(limit, 10) || 20, 1);
  const clampedLimit = safeLimit > 100 ? 100 : safeLimit;
  const skipCount = (safePage - 1) * clampedLimit;

  // Minimal, safe pipeline:
  // 1) $match (tenant/time)
  // 2) $group org total
  // 3) $group user totals and collect projects set
  // 4) $project users with projects_count
  // 5) $facet { data:[ $sort, $skip, $limit ], count:[ $count ] }
  // Normalize fields prior to grouping to avoid $type errors and simplify grouping keys
  const pipeline = [
    { $match: match || {} },
    {
      $addFields: {
        _org: {
          $toString: {
            $ifNull: [
              '$tenant_id',
              { $ifNull: ['$organization_id', { $ifNull: ['$organizationId', { $ifNull: ['$tenantId', '$orgId'] }] }] },
            ],
          },
        },
        _user: { $toString: { $ifNull: ['$user_id', { $ifNull: ['$userId', '$user'] }] } },
        _project: {
          $toString: {
            $ifNull: ['$project_id', { $ifNull: ['$projectId', { $ifNull: ['$project', '$project_code'] }] }],
          },
        },
        _cost: numericCostExpr(),
      },
    },
    {
      $facet: {
        org: [
          {
            $group: {
              _id: '$_org',
              organization_cost: { $sum: '$_cost' },
            },
          },
          {
            $project: {
              _id: 0,
              organization_id: '$_id',
              organization_cost: { $round: ['$organization_cost', 6] },
            },
          },
        ],
        users: [
          {
            $group: {
              _id: { user_id: '$_user', project_id: '$_project', organization_id: '$_org' },
              user_project_cost: { $sum: '$_cost' },
            },
          },
          {
            $group: {
              _id: { user_id: '$_id.user_id', organization_id: '$_id.organization_id' },
              user_cost: { $sum: '$user_project_cost' },
              projects: { $addToSet: '$_id.project_id' },
            },
          },
          {
            $project: {
              _id: 0,
              user_id: '$_id.user_id',
              organization_id: '$_id.organization_id',
              user_cost: { $round: ['$user_cost', 6] },
              projects_count: { $size: { $ifNull: ['$projects', []] } },
            },
          },
          { $sort: { user_cost: -1, user_id: 1 } },
          { $skip: skipCount },
          { $limit: clampedLimit },
        ],
        totalUsers: [
          { $group: { _id: { user_id: '$_user', organization_id: '$_org' } } },
          { $group: { _id: '$_id.user_id' } },
          { $count: 'total' },
        ],
      },
    },
    {
      $project: {
        org: { $arrayElemAt: ['$org', 0] },
        users: 1,
        total: { $ifNull: [{ $arrayElemAt: ['$totalUsers.total', 0] }, 0] },
      },
    },
  ];
  log('pipeline_ready', { stages: pipeline.length, page: safePage, limit: clampedLimit, skip: skipCount });

  let out = null;
  try {
    const agg = col.aggregate(pipeline, { allowDiskUse: true, maxTimeMS: 4000 });

    // Apply index hints if possible
    try {
      const m = JSON.stringify(match || {});
      if (m.includes('"organization_id"') || m.includes('"organizationId"')) {
        agg.hint({ organization_id: 1, timestamp: -1, _id: 1 });
        log('hint_applied', { hint: { organization_id: 1, timestamp: -1, _id: 1 } });
      } else if (m.includes('"tenant_id"') || m.includes('"tenantId"')) {
        agg.hint({ tenant_id: 1, timestamp: -1, _id: 1 });
        log('hint_applied', { hint: { tenant_id: 1, timestamp: -1, _id: 1 } });
      } else {
        agg.hint({ timestamp: -1, _id: 1 });
        log('hint_applied', { hint: { timestamp: -1, _id: 1 } });
      }
    } catch (eHint) {
      log('hint_error', { error: eHint?.message || String(eHint) });
    }

    const docs = await agg.toArray();
    out = docs && docs[0] ? docs[0] : { org: null, users: [], total: 0 };
    log('aggregation_completed', { users: out.users?.length || 0, total: out.total || 0 });
  } catch (e) {
    log('aggregation_failed', { error: e?.message || String(e) });
    return {
      _id: tenantId ? String(tenantId) : 'all-tenants',
      organization_id: tenantId ? String(tenantId) : 'all-tenants',
      organization_cost: 0,
      users: [],
      totalUsers: 0,
      meta_debug: { stageLog },
    };
  }

  const org = out.org || { organization_cost: 0, organization_id: tenantId ? String(tenantId) : null };
  const result = {
    _id: org.organization_id || (tenantId ? String(tenantId) : 'all-tenants'),
    organization_id: org.organization_id || (tenantId ? String(tenantId) : 'all-tenants'),
    organization_cost: Number(org.organization_cost || 0),
    users: Array.isArray(out.users)
      ? out.users.map((u) => ({
          user_id: String(u.user_id || ''),
          type: 'llm_interaction',
          user_cost: Number(u.user_cost || 0),
          project_count: Number(u.projects_count || 0),
          projects: [], // not needed for flat response
        }))
      : [],
    totalUsers: Number(out.total || 0),
    meta_debug: { stageLog },
  };
  log('shape_done', { totalUsers: result.totalUsers, organization_cost: result.organization_cost });

  return result;
}

module.exports = {
  // PUBLIC_INTERFACE
  aggregateOrganizationCosts,
};
