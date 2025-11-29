'use strict';

const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * listLLMCosts
 * GET /api/llm-costs
 *
 * Returns a fast, paginated per-user list derived from llm-costs documents.
 * Fields: id (source _id), organization_id, organization_name (if present), organization_cost (numeric),
 *         user_id, type (feature), user_cost (numeric), project_count (size per document for user's projects).
 *
 * Tenant resolution:
 * - Uses req.tenantId from middleware if present, else x-organization-id header, else ?organization_id|tenant_id.
 * - If req.tenantScopeDisabled is set (e.g., T0000 bypass), no tenant $match is applied.
 *
 * Performance:
 * - $match on organization_id variants
 * - $addFields numeric conversions (strip '$' when needed) using $replaceAll + $toDouble
 * - $unwind users
 * - $addFields project_count = $size of projects array (or 0)
 * - $project only required fields
 * - $sort by createdAt desc then _id desc (fallback to _id desc)
 * - $facet items/total with $skip/$limit
 * - allowDiskUse(true)
 */
async function listLLMCosts(req, res, next) {
  try {
    const {
      page: pageRaw,
      limit: limitRaw,
      sort: sortRaw,
      organization_id: orgQuery,
      tenant_id: tenantQuery,
    } = req.query;

    const bypass = !!(req.tenantScopeDisabled || req.allTenants);
    const headerTenant =
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
      undefined;

    const resolvedTenant = bypass ? undefined : (req.tenantId || headerTenant || orgQuery || tenantQuery || undefined);

    // Sorting
    let sortStage = {};
    if (sortRaw && typeof sortRaw === 'string' && sortRaw.trim()) {
      sortRaw.split(',').forEach((s) => {
        const v = s.trim();
        if (!v) return;
        if (v.startsWith('-')) sortStage[v.slice(1)] = -1;
        else sortStage[v] = 1;
      });
    }
    if (!Object.keys(sortStage).length) {
      sortStage = { createdAt: -1, _id: -1 };
    }

    const page = Math.max(parseInt(pageRaw, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 20, 1), 200);
    const skip = (page - 1) * limit;

    // Tenant match
    const match = {};
    if (resolvedTenant) {
      const t = String(resolvedTenant);
      match.$or = [
        { organization_id: t },
        { tenant_id: t },
        { organizationId: t },
        { tenantId: t },
        { orgId: t },
        { 'tenant.tenant_id': t },
      ];
    }

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
          organization_name_preferred: {
            $ifNull: ['$organization_name', { $ifNull: ['$tenant.name', null] }],
          },
          org_cost_str: {
            $ifNull: [
              '$organization_cost',
              { $ifNull: ['$total_cost', { $ifNull: ['$total', { $ifNull: ['$cost', 0] }] }] },
            ],
          },
          users_arr: { $ifNull: ['$users', []] },
          projects_arr: { $ifNull: ['$project', []] },
          type_preferred: { $ifNull: ['$type', 'llm_interaction'] },
        },
      },
      { $sort: sortStage },
      {
        $project: {
          _id: 1,
          createdAt: 1,
          organization_preferred: 1,
          organization_name_preferred: 1,
          org_cost_str: 1,
          users_arr: 1,
          projects_arr: 1,
          type_preferred: 1,
        },
      },
      { $unwind: { path: '$users_arr', preserveNullAndEmptyArrays: false } },
      {
        $addFields: {
          // Convert organization cost to number: strip '$' when present then toDouble
          organization_cost: {
            $toDouble: {
              $replaceAll: {
                input: { $toString: '$org_cost_str' },
                find: '$',
                replacement: '',
              },
            },
          },
          // Resolve user_id
          user_id: {
            $toString: {
              $ifNull: [
                '$users_arr.user_id',
                { $ifNull: ['$users_arr.userId', { $ifNull: ['$users_arr.id', '$users_arr.uid'] }] },
              ],
            },
          },
          // Convert user_cost to number: strip '$' when present then toDouble
          user_cost: {
            $toDouble: {
              $replaceAll: {
                input: {
                  $toString: {
                    $ifNull: [
                      '$users_arr.user_cost',
                      { $ifNull: ['$users_arr.total_cost', { $ifNull: ['$users_arr.cost', 0] }] },
                    ],
                  },
                },
                find: '$',
                replacement: '',
              },
            },
          },
          project_count: { $size: '$projects_arr' },
        },
      },
      {
        $project: {
          _id: 0,
          id: '$_id',
          organization_id: '$organization_preferred',
          organization_name: '$organization_name_preferred',
          organization_cost: 1,
          user_id: 1,
          type: '$type_preferred',
          user_cost: 1,
          project_count: 1,
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
  listLLMCosts,
};
