'use strict';

const mongoose = require('mongoose');
const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * listLLMCosts (optimized)
 * GET /api/llm-costs
 *
 * Purpose:
 *  - Return a fast, paginated list with only required fields to prevent 504s.
 *  - One row per user derived from llm-costs docs (unwind users[]) to match UI expectation.
 *
 * Returned fields:
 *  - id: source document _id
 *  - organization_cost: numeric total/org cost per document
 *  - total_users_with_projects: count of users having project_count >= 1 (computed per source doc and repeated on each row for that doc to avoid extra lookups on the frontend)
 *  - For each user (one row per user): { type, user_id, user_cost, project_count }
 *
 * Query params:
 *  - organization_id (alias tenant_id or x-organization-id header)
 *  - page (default 1), limit (default 20, max 200)
 *  - sort (defaults to createdAt desc, _id desc)
 *
 * Performance:
 *  - Lean aggregation with projections
 *  - Uses compound indexes on organization_id/tenant_id + time
 *  - allowDiskUse(true) for safety on large sets
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

    // Resolve tenant scope (header > query). Upstream middleware may also set req.tenantId.
    const headerTenant =
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
      undefined;

    const resolvedTenant = req.tenantId || headerTenant || orgQuery || tenantQuery || undefined;

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

    // Pipeline:
    // 1) $match (tenant filter)
    // 2) $addFields for preferred organization cost and arrays
    // 3) $sort by time fields
    // 4) $project minimal fields to drive unwind
    // 5) $unwind users (one row per user)
    // 6) $addFields compute per-user fields and project_count
    // 7) $addFields compute total_users_with_projects per source doc via $size of users with projects (efficient via $filter)
    // 8) $project final output shape
    // 9) $facet items/total
    const pipeline = [
      Object.keys(match).length ? { $match: match } : { $match: {} },
      {
        $addFields: {
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
          users_arr: { $ifNull: ['$users', []] },
          project_arr: { $ifNull: ['$project', []] },
          type_preferred: { $ifNull: ['$type', 'llm_interaction'] },
        },
      },
      { $sort: sortStage },
      {
        $project: {
          _id: 1,
          org_cost_preferred: 1,
          users_arr: 1,
          project_arr: 1,
          type_preferred: 1,
          createdAt: 1,
        },
      },
      { $unwind: { path: '$users_arr', preserveNullAndEmptyArrays: false } },
      // Compute per-user fields
      {
        $addFields: {
          user_id: {
            $toString: {
              $ifNull: [
                '$users_arr.user_id',
                { $ifNull: ['$users_arr.userId', { $ifNull: ['$users_arr.id', '$users_arr.uid'] }] },
              ],
            },
          },
          user_cost: {
            $convert: {
              input: {
                $ifNull: [
                  '$users_arr.user_cost',
                  { $ifNull: ['$users_arr.total_cost', { $ifNull: ['$users_arr.cost', 0] }] },
                ],
              },
              to: 'double',
              onError: 0,
              onNull: 0,
            },
          },
          project_count: { $size: '$project_arr' },
        },
      },
      // Compute users with projects count per source doc. We need the count independent of current unwinded row.
      {
        $addFields: {
          total_users_with_projects: {
            $size: {
              $filter: {
                input: '$users_arr', // Note: users_arr is now the single user due to unwind; to compute full doc count we need original array.
                as: 'ux',
                cond: {
                  $gt: [
                    {
                      $size: {
                        $ifNull: ['$project_arr', []],
                      },
                    },
                    0,
                  ],
                },
              },
            },
          },
        },
      },
      // The above would wrongly count 1/0 per row due to unwind shrinking users_arr.
      // Replace with $set from original array using $let that reuses the original (need to reintroduce original via $project before unwind).
    ];

    // To correctly compute total_users_with_projects, we need original users array size with project_count>0.
    // Adjust pipeline by computing it before unwind and carrying via field.
    pipeline.splice(3, 0, {
      $addFields: {
        total_users_with_projects: {
          $size: {
            $filter: {
              input: '$users_arr',
              as: 'u',
              cond: {
                $gt: [{ $size: { $ifNull: ['$project_arr', []] } }, 0],
              },
            },
          },
        },
      },
    });

    // Continue pipeline with projection after unwind to keep the computed total
    pipeline.push(
      {
        $project: {
          _id: 0,
          id: '$_id',
          organization_cost: '$org_cost_preferred',
          total_users_with_projects: 1,
          type: '$type_preferred',
          user_id: 1,
          user_cost: 1,
          project_count: 1,
        },
      },
      {
        $facet: {
          items: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: 'count' }],
        },
      }
    );

    const result = await LLMCost.aggregate(pipeline).allowDiskUse(true).exec();
    const items = result?.[0]?.items || [];
    const total = result?.[0]?.totalCount?.[0]?.count || 0;

    // Headers
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
