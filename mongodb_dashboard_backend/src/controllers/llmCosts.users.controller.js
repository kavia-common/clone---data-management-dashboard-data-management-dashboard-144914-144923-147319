'use strict';

const LLMCost = require('../models/llmCosts.model');

/**
// PUBLIC_INTERFACE
 * listPerUserLLMCosts
 * GET /api/llm-costs/users
 * Returns a per-user list aggregated from llm-costs documents with fast pagination.
 *
 * Summary:
 * - One row per user (unwinds users array).
 * - Fields: id (source document _id), organization_id, user_id, type, user_cost (from users.*), project_count (from per-doc 'project' array), organization_cost (per-doc total or sum across users).
 * - Server-side pagination over users: ?page, ?limit
 * - Optional filter: ?organization_id (alias tenant_id) to scope by org.
 * - Stable sort by createdAt desc (fallback _id desc).
 * - Performance: lean aggregation pipeline, stage projections, allowDiskUse(true).
 *
 * Query params:
 * - page: integer, default 1
 * - limit: integer, default 20, max 200
 * - organization_id | tenant_id (alias): optional filter when JWT tenant not present (middleware enforces scoping)
 * - sort: optional sort string; default: createdAt desc, _id desc
 *
 * Response:
 * { items: [{ id, organization_id, user_id, type, user_cost, project_count, organization_cost }], page, limit, total }
 */
async function listPerUserLLMCosts(req, res, next) {
  try {
    const {
      page: pageRaw,
      limit: limitRaw,
      sort: sortRaw,
      organization_id: orgQuery,
      tenant_id: tenantQuery,
    } = req.query;

    // Resolve tenant/organization id
    // Respect scoping: if middleware set req.tenantId and didn't mark bypass, use it; otherwise allow header/query.
    const bypass = !!(req.tenantScopeDisabled || req.allTenants);
    const headerTenant =
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
      undefined;

    const resolvedTenant = bypass ? undefined : (req.tenantId || headerTenant || orgQuery || tenantQuery || undefined);

    // Sort
    let sortStage = {};
    if (sortRaw && typeof sortRaw === 'string' && sortRaw.trim()) {
      sortRaw.split(',').forEach((s) => {
        const v = s.trim();
        if (!v) return;
        if (v.startsWith('-')) sortStage[v.slice(1)] = -1;
        else sortStage[v] = 1;
      });
    } else {
      sortStage = { createdAt: -1, _id: -1 };
    }

    // Pagination
    const page = Math.max(parseInt(pageRaw, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 20, 1), 200);
    const skip = (page - 1) * limit;

    // Match stage: enforce tenant if resolved; support various field variants in data
    const match = {};
    if (resolvedTenant) {
      const t = String(resolvedTenant);
      match.$or = [
        { tenant_id: t },
        { organization_id: t },
        { tenantId: t },
        { organizationId: t },
        { orgId: t },
        { 'tenant.tenant_id': t },
      ];
    }

    // Aggregation pipeline:
    // 1) $match (tenant)
    // 2) $addFields organization_preferred and org_cost_preferred (numerics)
    // 3) $sort (doc-level)
    // 4) $project minimal fields to go into unwind
    // 5) $unwind users
    // 6) $addFields for computed fields per user
    // 7) $project output fields
    // 8) $facet items/total
    const pipeline = [
      Object.keys(match).length ? { $match: match } : { $match: {} },
      {
        $addFields: {
          organization_preferred: {
            $ifNull: [
              '$organization_id',
              {
                $ifNull: ['$organizationId', { $ifNull: ['$tenant_id', { $ifNull: ['$tenantId', { $ifNull: ['$orgId', '$tenant.tenant_id'] }] }] }],
              },
            ],
          },
          // Robust numeric conversion for total/organization cost field
          org_cost_preferred: {
            $convert: {
              input: {
                $ifNull: [
                  '$organization_cost',
                  {
                    $ifNull: [
                      '$total_cost',
                      { $ifNull: ['$total', { $ifNull: ['$cost', 0] }] },
                    ],
                  },
                ],
              },
              to: 'double',
              onError: 0,
              onNull: 0,
            },
          },
          project_arr: { $ifNull: ['$project', []] },
        },
      },
      { $sort: sortStage },
      {
        // Keep only the necessary fields before unwind
        $project: {
          _id: 1,
          organization_preferred: 1,
          users: { $ifNull: ['$users', []] },
          project_arr: 1,
          type: 1,
          org_cost_preferred: 1,
          createdAt: 1,
        },
      },
      { $unwind: { path: '$users', preserveNullAndEmptyArrays: false } },
      {
        $addFields: {
          // Prefer common fields in user entry
          user_id: {
            $toString: {
              $ifNull: [
                '$users.user_id',
                { $ifNull: ['$users.userId', { $ifNull: ['$users.id', '$users.uid'] }] },
              ],
            },
          },
          // Prefer value field names in users entry
          user_cost: {
            $convert: {
              input: {
                $ifNull: [
                  '$users.user_cost',
                  {
                    $ifNull: [
                      '$users.total_cost',
                      { $ifNull: ['$users.cost', 0] },
                    ],
                  },
                ],
              },
              to: 'double',
              onError: 0,
              onNull: 0,
            },
          },
          // Project count strictly from users.projects?.length
          project_count: {
            $size: {
              $ifNull: ['$users.projects', []],
            },
          },
          type_preferred: { $ifNull: ['$type', 'llm_interaction'] },
        },
      },
      {
        $project: {
          _id: 0,
          id: '$_id',
          organization_id: '$organization_preferred',
          user_id: 1,
          type: '$type_preferred',
          user_cost: 1,
          project_count: 1,
          organization_cost: '$org_cost_preferred',
        },
      },
      {
        $facet: {
          items: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    const result = await LLMCost.aggregate(pipeline).allowDiskUse(true).exec();
    const items = result?.[0]?.items || [];
    const total = result?.[0]?.totalCount?.[0]?.count || 0;

    // Set diagnostics
    try {
      if (resolvedTenant) res.set('X-Applied-Tenant', String(resolvedTenant));
      res.set('X-Model-Collection', LLMCost.collection?.name || 'llm-costs');
    } catch (_) {}

    return res.status(200).json({
      items,
      page,
      limit,
      total,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listPerUserLLMCosts,
};
