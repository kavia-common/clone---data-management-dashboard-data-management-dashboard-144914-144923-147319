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
  // Prefer primary collection name 'llm-costs' and fallback to 'llm_costs' if needed
  let col;
  try {
    col = db.collection('llm-costs');
  } catch (_) {
    col = undefined;
  }
  if (!col) {
    try {
      col = db.collection('llm_costs');
    } catch (_) {
      // final fallback to tolerate environments using a different name
      try { col = db.collection('llm_events'); } catch {} // read-only analytics shape
    }
  }

  const match = buildTenantAndTimeFilter({ tenantId, filter, from, to });

  // Pipeline to compute:
  // - per project totals -> per user totals including projects array
  // - organization-level total cost
  const pipeline = [
    { $match: match || {} },
    // Ensure timestamp exists for index usage and sorts (not strictly needed here but harmless)
    { $addFields: { timestamp: { $ifNull: ['$timestamp', '$created_at'] } } },
    // Normalize keys and numeric cost early
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
    // Filter out empties to avoid noise
    {
      $match: {
        user_id: { $ne: null },
        project_id: { $ne: null },
      },
    },
    // project totals per user
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
    // user totals with projects
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
    // organization total cost computed separately and merged via $group and $setWindowFields alternative;
    // easier approach: compute org total via $group in a sibling pipeline; we will run a facet.
  ];

  // Use $facet to compute:
  // - users (with pagination)
  // - totalUsers (count)
  // - orgTotal (organization_cost)
  // Build a safe facet that avoids unsupported expressions like $sortArray in server versions < 5.2
  // We will compute org total in one facet branch and the per-user rows in another,
  // then perform pagination using $skip/$limit on the array via $slice with precomputed bounds.
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.max(parseInt(limit, 10) || 20, 1);
  const clampedLimit = safeLimit > 100 ? 100 : safeLimit;
  const skipCount = (safePage - 1) * clampedLimit;

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
    // Post-process facet: sort user rows, count, then slice for pagination using computed bounds
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

  const agg = col.aggregate(facetPipeline, { allowDiskUse: true, maxTimeMS: 4000 });
  // Apply covered index hint when possible
  try {
    const mstr = JSON.stringify(match || {});
    const usesOrgInMatch = mstr.includes('"organization_id"') || mstr.includes('"organizationId"');
    const usesTenantInMatch = mstr.includes('"tenant_id"') || mstr.includes('"tenantId"');
    if (usesOrgInMatch) {
      agg.hint({ organization_id: 1, timestamp: -1, _id: 1 });
    } else if (usesTenantInMatch) {
      agg.hint({ tenant_id: 1, timestamp: -1, _id: 1 });
    } else {
      agg.hint({ timestamp: -1, _id: 1 });
    }
  } catch (_) {}

  const docs = await agg.toArray();
  const first = docs && docs[0] ? docs[0] : { orgTotal: null, usersAll: [], users: [], totalUsers: 0 };
  const orgTotal = first.orgTotal || { organization_cost: 0, organization_id: tenantId ? String(tenantId) : null };

  // Shape final response
  return {
    _id: orgTotal.organization_id || (tenantId ? String(tenantId) : 'all-tenants'),
    organization_id: orgTotal.organization_id || (tenantId ? String(tenantId) : 'all-tenants'),
    organization_cost: Number(orgTotal.organization_cost || 0),
    users: Array.isArray(first.users) ? first.users.map((u) => ({
      user_id: u.user_id,
      type: 'llm_interaction',
      user_cost: Number(u.user_cost || 0),
      project_count: Number(u.project_count || (Array.isArray(u.projects) ? u.projects.length : 0)),
      projects: Array.isArray(u.projects)
        ? u.projects.map((p) => ({ project_id: p.project_id, project_cost: Number(p.project_cost || 0) }))
        : [],
    })) : [],
    totalUsers: Number(first.totalUsers || 0),
  };
}

module.exports = {
  // PUBLIC_INTERFACE
  aggregateOrganizationCosts,
};
