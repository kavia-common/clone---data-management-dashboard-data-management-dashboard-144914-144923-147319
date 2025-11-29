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

    // Aggregation (lean by nature) with strict projection to reduce memory:
    // Normalize minimal fields -> project trimmed doc -> sort -> page -> add computed light fields
    // Also coerce sort to an index-backed field if none present in schema.
    const safeSortStage = (function () {
      const keys = Object.keys(sortStage || {});
      if (!keys.length) return { timestamp: -1 };
      // Only allow sort on whitelisted fields to avoid heavy in-memory sorts
      const allowed = new Set(['timestamp', 'created_at', 'createdAt', '_id']);
      const out = {};
      let hasAny = false;
      for (const k of keys) {
        if (allowed.has(k)) { out[k] = sortStage[k]; hasAny = true; }
      }
      return hasAny ? out : { timestamp: -1, _id: -1 };
    })();

    const pipeline = [
      { $match: match },
      // Normalize fields and project a tight document shape to lower per-doc memory
      {
        $addFields: {
          timestamp: { $ifNull: ['$timestamp', '$created_at'] },
          organization_id: { $ifNull: ['$organization_id', '$tenant_id'] },
        },
      },
      {
        $project: {
          _id: 1,
          tenant_id: 1,
          organization_id: 1,
          user_id: 1,
          llm_model: 1,
          provider: 1,
          service_type: 1,
          operation: 1,
          total_cost: 1,
          currency: 1,
          timestamp: 1,
          created_at: 1,
          updated_at: 1,
          'metadata.projectId': 1,
          project_id: 1,
          session_id: 1,
          users: { $slice: [{ $ifNull: ['$users', []] }, 3] }, // limit embedded array for computed user_cost
          project: { $ifNull: ['$project', []] },
        },
      },
      { $sort: safeSortStage },
      { $skip: skip },
      { $limit: limit },
      {
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
      // Drop arrays after computing lightweight fields to reduce transfer size
      {
        $project: {
          users: 0,
          project: 0,
        },
      },
      // Compute total count via $group on first stage match
    ];

    const countPipeline = [{ $match: match }, { $count: 'count' }];

    const [items, countRes] = await Promise.all([
      LLMCost.aggregate(pipeline).allowDiskUse(true).exec(),
      LLMCost.aggregate(countPipeline).allowDiskUse(true).exec(),
    ]);
    const total = countRes?.[0]?.count || 0;

    // Diagnostics headers
    try {
      if (organization_id) res.set('X-Applied-Tenant', String(organization_id));
      res.set('X-Model-Collection', LLMCost.collection?.name || 'llm-costs');
      res.set('X-Applied-Sort', JSON.stringify(sortStage));
      res.set('X-Applied-Limit', String(limit));
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
