'use strict';

const mongoose = require('mongoose');
const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * listLLMCosts
 * GET /api/llm-costs
 *
 * Purpose:
 *  - Fix 504s by returning a fast, paginated per-user list using efficient aggregation.
 *  - One row per user from llm-costs (unwind users[]), with only requested fields.
 *
 * Returned fields per row:
 *  - type, user_id, user_cost, organization_cost, project_count, id
 *
 * Query params:
 *  - organization_id (alias tenant_id or x-organization-id header)
 *  - page (default 1), limit (default 20, max 200)
 *  - sort (defaults to createdAt desc, _id desc). Sorting uses indexed fields for performance.
 *
 * Performance:
 *  - $match on organization_id/tenant variants
 *  - $sort on { createdAt: -1, _id: -1 } or {_id:-1} when createdAt missing
 *  - $project to minimize payload
 *  - $unwind users
 *  - allowDiskUse(true)
 */
// PUBLIC_INTERFACE
async function listLLMCosts(req, res, next) {
  try {
    const {
      page: pageRaw,
      limit: limitRaw,
      sort: sortRaw,
      organization_id: orgQuery,
      tenant_id: tenantQuery,
    } = req.query;

    // Resolve tenant scope (header > query). Upstream middleware may set req.tenantId.
    const headerTenant =
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
      undefined;

    const resolvedTenant = req.tenantId || headerTenant || orgQuery || tenantQuery || undefined;

    // Sort on indexed fields only
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

    // Pagination
    const page = Math.max(parseInt(pageRaw, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 20, 1), 200);
    const skip = (page - 1) * limit;

    // Tenant $match
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

    // Aggregation pipeline returning one row per user with requested fields
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
          org_cost_preferred: {
            $convert: {
              input: {
                $ifNull: [
                  '$organization_cost',
                  { $ifNull: ['$total_cost', { $ifNull: ['$total', { $ifNull: ['$cost', 0] }] }] },
                ],
              },
              to: 'double',
              onError: 0,
              onNull: 0,
            },
          },
          projects_arr: { $ifNull: ['$project', []] },
          type_preferred: { $ifNull: ['$type', 'llm_interaction'] },
        },
      },
      { $sort: sortStage },
      {
        $project: {
          _id: 1,
          createdAt: 1,
          type_preferred: 1,
          organization_preferred: 1,
          org_cost_preferred: 1,
          projects_arr: 1,
          users: { $ifNull: ['$users', []] },
        },
      },
      { $unwind: { path: '$users', preserveNullAndEmptyArrays: false } },
      {
        $addFields: {
          user_id: {
            $toString: {
              $ifNull: [
                '$users.user_id',
                { $ifNull: ['$users.userId', { $ifNull: ['$users.id', '$users.uid'] }] },
              ],
            },
          },
          user_cost: {
            $convert: {
              input: {
                $ifNull: [
                  '$users.user_cost',
                  { $ifNull: ['$users.total_cost', { $ifNull: ['$users.cost', 0] }] },
                ],
              },
              to: 'double',
              onError: 0,
              onNull: 0,
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          id: '$_id',
          organization_id: '$organization_preferred',
          type: '$type_preferred',
          user_id: 1,
          user_cost: 1,
          project_count: { $size: '$projects_arr' },
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

    // Headers for diagnostics
    try {
      if (resolvedTenant) res.set('X-Applied-Tenant', String(resolvedTenant));
      res.set('X-Model-Collection', LLMCost.collection?.name || 'llm-costs');
    } catch {}

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
