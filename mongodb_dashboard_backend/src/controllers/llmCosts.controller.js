'use strict';

const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * listLLMCosts
 * GET /api/llm-costs
 *
 * Robust, fast per-user listing from llm-costs with safe parsing and pagination.
 * Returns: { items, page, limit, total }
 * Each item: { id, organization_id, organization_name, organization_cost, user_id, type, user_cost, project_count }
 *
 * Notes:
 * - Guard for undefined/missing arrays and fields.
 * - Parse currency strings by stripping '$' and ',' before conversion.
 * - Avoid referencing non-existent fields like createdAt if absent; default sort includes _id desc.
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

    // Determine tenant scope (middleware may set req.tenantId)
    const bypass = !!(req.tenantScopeDisabled || req.allTenants);
    const headerTenant =
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
      undefined;
    const resolvedTenant = bypass ? undefined : (req.tenantId || headerTenant || orgQuery || tenantQuery || undefined);

    // Parse sort param; default to createdAt desc then _id desc
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

    // Helper expressions for safe currency-to-double conversion
    const stripCurrencyExpr = (field) => ({
      $replaceAll: {
        input: {
          $replaceAll: {
            input: { $toString: field },
            find: ',',
            replacement: '',
          },
        },
        find: '$',
        replacement: '',
      },
    });

    const pipeline = [
      Object.keys(match).length ? { $match: match } : { $match: {} },
      {
        $addFields: {
          organization_preferred: {
            $ifNull: [
              '$organization_id',
              {
                $ifNull: [
                  '$organizationId',
                  { $ifNull: ['$tenant_id', { $ifNull: ['$tenantId', { $ifNull: ['$orgId', '$tenant.tenant_id'] }] }] },
                ],
              },
            ],
          },
          organization_name_preferred: {
            $ifNull: ['$organization_name', { $ifNull: ['$tenant.name', null] }],
          },
          // Prefer a numeric value but handle strings like "$3,005.44"
          organization_cost_num: {
            $convert: {
              input: stripCurrencyExpr({
                $ifNull: [
                  '$organization_cost',
                  { $ifNull: ['$total_cost', { $ifNull: ['$total', { $ifNull: ['$cost', 0] }] }] },
                ],
              }),
              to: 'double',
              onError: 0,
              onNull: 0,
            },
          },
          users_arr: { $ifNull: ['$users', []] },
          projects_arr: { $ifNull: ['$project', []] },
          type_preferred: { $ifNull: ['$type', 'llm_interaction'] },
        },
      },
      // Sort at document level; createdAt may not exist on some docs, but _id ensures stable sort.
      { $sort: sortStage },
      {
        // Keep minimal fields to reduce memory
        $project: {
          _id: 1,
          createdAt: 1,
          organization_preferred: 1,
          organization_name_preferred: 1,
          organization_cost_num: 1,
          users_arr: 1,
          projects_arr: 1,
          type_preferred: 1,
        },
      },
      // One row per user
      { $unwind: { path: '$users_arr', preserveNullAndEmptyArrays: false } },
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
              input: stripCurrencyExpr({
                $ifNull: [
                  '$users_arr.user_cost',
                  { $ifNull: ['$users_arr.total_cost', { $ifNull: ['$users_arr.cost', 0] }] },
                ],
              }),
              to: 'double',
              onError: 0,
              onNull: 0,
            },
          },
          project_count: { $size: { $ifNull: ['$projects_arr', []] } },
        },
      },
      // Final output projection
      {
        $project: {
          _id: 0,
          id: '$_id',
          organization_id: '$organization_preferred',
          organization_name: '$organization_name_preferred',
          organization_cost: '$organization_cost_num',
          user_id: 1,
          type: '$type_preferred',
          user_cost: 1,
          project_count: 1,
        },
      },
      // Pagination + total count
      {
        $facet: {
          items: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    const result = await LLMCost.aggregate(pipeline).allowDiskUse(true).exec();
    const items = (result && result[0] && result[0].items) || [];
    const total = (result && result[0] && result[0].totalCount && result[0].totalCount[0] && result[0].totalCount[0].count) || 0;

    try {
      if (resolvedTenant) res.set('X-Applied-Tenant', String(resolvedTenant));
      res.set('X-Model-Collection', LLMCost.collection?.name || 'llm-costs');
    } catch (_) {}

    return res.status(200).json({ items, page, limit, total });
  } catch (err) {
    // Robust error handler: return 500 with minimal info
    return next(err);
  }
}

module.exports = {
  listLLMCosts,
};
