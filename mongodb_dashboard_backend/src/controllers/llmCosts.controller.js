'use strict';

const mongoose = require('mongoose');
const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * listLLMCosts
 * Returns a fast, paginated listing of full LLM cost documents augmented with computed fields.
 * Augments each document with:
 *  - id: document _id (stringified by Express JSON)
 *  - user_cost: derived from users array (first non-null users[].user_cost or 0 if missing)
 *  - project_count: length of project array (0 if missing)
 *
 * Query params:
 *  - page: integer page number (default 1)
 *  - limit: integer page size (default 20, max 200)
 *  - organization_id | tenant_id | x-organization-id header: optional tenant scope filter (ignored when JWT tenant enforced upstream)
 *  - sort: optional; defaults to createdAt/created_at/timestamp/_id desc
 *  - filter: optional JSON string; tenant fields ignored server-side
 *
 * Performance:
 *  - Uses aggregation pipeline with $match, $sort, and $facet for items + totalCount
 *  - Uses $addFields to compute id, user_cost, and project_count while preserving full documents
 *  - Relies on model indexes for tenant + createdAt/timestamp sorts
 */
// PUBLIC_INTERFACE
async function listLLMCosts(req, res, next) {
  try {
    const {
      page: pageRaw,
      limit: limitRaw,
      sort: sortRaw,
      filter: filterRaw,
      organization_id: orgQuery,
      tenant_id: tenantQuery,
    } = req.query;

    // Resolve tenant scope: header takes precedence in absence of upstream enforcement (verifyAuth/requireTenant attach req.tenantId normally)
    const headerTenant =
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
      undefined;
    const organization_id = headerTenant || orgQuery || tenantQuery || undefined;

    // Parse additional filter, ignoring any client-provided tenant fields
    let userFilter = {};
    if (filterRaw) {
      try {
        userFilter = JSON.parse(filterRaw);
      } catch (e) {
        return res.status(400).json({ success: false, error: 'Invalid filter JSON' });
      }
    }
    // Strip tenant hints from user filter
    delete userFilter.organization_id;
    delete userFilter.organizationId;
    delete userFilter.orgId;
    delete userFilter.tenant_id;
    delete userFilter.tenantId;
    delete userFilter['tenant.tenant_id'];

    // Construct match
    const match = { ...userFilter };
    if (organization_id) {
      // Support documents that may use either tenant_id or organization_id
      match.$or = [
        { organization_id: String(organization_id) },
        { tenant_id: String(organization_id) },
        { organizationId: String(organization_id) },
        { tenantId: String(organization_id) },
        { orgId: String(organization_id) },
        { 'tenant.tenant_id': String(organization_id) },
      ];
    }

    // Sorting: default to time-like fields desc, with _id as a tiebreaker
    let sortStage = {};
    if (sortRaw && typeof sortRaw === 'string' && sortRaw.trim().length > 0) {
      sortRaw.split(',').forEach((s) => {
        const v = s.trim();
        if (!v) return;
        if (v.startsWith('-')) sortStage[v.slice(1)] = -1;
        else sortStage[v] = 1;
      });
    } else {
      // Prefer commonly used time fields, fallback to _id
      sortStage = { createdAt: -1, created_at: -1, timestamp: -1, _id: -1 };
    }

    // Pagination
    const page = Math.max(parseInt(pageRaw, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 20, 1), 200);
    const skip = (page - 1) * limit;

    // Aggregation (lean by nature): match → sort → facet(items, totalCount); within items compute fields but keep full docs
    const pipeline = [
      { $match: match },
      { $sort: sortStage },
      {
        $facet: {
          items: [
            { $skip: skip },
            { $limit: limit },
            {
              // Compute fields and keep all original fields
              $addFields: {
                id: '$_id',
                user_cost: {
                  $ifNull: [
                    {
                      $first: {
                        $filter: {
                          input: {
                            $map: {
                              input: { $ifNull: ['$users', []] },
                              as: 'u',
                              in: '$$u.user_cost',
                            },
                          },
                          as: 'c',
                          cond: { $ne: ['$$c', null] },
                        },
                      },
                    },
                    0,
                  ],
                },
                project_count: { $size: { $ifNull: ['$project', []] } },
              },
            },
          ],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    const result = await LLMCost.aggregate(pipeline).allowDiskUse(true).exec();
    const items = result?.[0]?.items || [];
    const total = result?.[0]?.totalCount?.[0]?.count || 0;

    // Diagnostics headers
    try {
      if (organization_id) res.set('X-Applied-Tenant', String(organization_id));
      res.set('X-Model-Collection', LLMCost.collection?.name || 'llm-costs');
    } catch (_) {}

    // Response shape as requested
    return res.status(200).json({
      items,
      total,
      page,
      limit,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listLLMCosts,
};
