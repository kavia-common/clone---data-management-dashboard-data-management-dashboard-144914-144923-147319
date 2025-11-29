'use strict';

const mongoose = require('mongoose');
const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * listLLMCosts
 * Returns a fast, paginated listing of LLM cost documents with computed fields.
 * Computes:
 *  - id: document _id
 *  - user_cost: derived from users array (first non-null users[].user_cost or 0 if missing)
 *  - project_count: count of items in project array (0 if missing)
 *
 * Query params:
 *  - page: integer page number (default 1)
 *  - limit: integer page size (default 20, max 200)
 *  - organization_id | tenant_id | x-organization-id header: optional tenant scope filter
 *  - sort: optional; defaults to createdAt/created_at/timestamp desc if present, else _id desc
 *  - filter: optional JSON string; tenant fields ignored server-side
 *
 * Performance:
 *  - Uses aggregation pipeline with $match, $sort, and $facet for data + totalCount
 *  - Uses $project to only return id, user_cost, project_count
 *  - Model defines compound indexes to support sort/filter
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

    // Resolve tenant scope: header takes precedence, allow query aliases if header missing
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
        delete userFilter.organization_id;
        delete userFilter.tenant_id;
        delete userFilter.tenantId;
        delete userFilter.organizationId;
      } catch (e) {
        return res.status(400).json({ success: false, error: 'Invalid filter JSON' });
      }
    }

    // Construct match
    const match = { ...userFilter };
    if (organization_id) {
      // Support documents that may use either tenant_id or organization_id
      match.$or = [
        { organization_id: String(organization_id) },
        { tenant_id: String(organization_id) },
        { organizationId: String(organization_id) },
        { tenantId: String(organization_id) },
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

    // Aggregation (lean by nature): match → sort → facet(data, totalCount) → project minimal fields
    const pipeline = [
      { $match: match },
      { $sort: sortStage },
      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 0,
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
    const data = result?.[0]?.data || [];
    const total = result?.[0]?.totalCount?.[0]?.count || 0;

    // Diagnostics headers
    try {
      if (organization_id) res.set('X-Applied-Tenant', String(organization_id));
      res.set('X-Model-Collection', LLMCost.collection?.name || 'llm-costs');
    } catch (_) {}

    return res.json({ success: true, data, meta: { page, limit, total } });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listLLMCosts,
};
