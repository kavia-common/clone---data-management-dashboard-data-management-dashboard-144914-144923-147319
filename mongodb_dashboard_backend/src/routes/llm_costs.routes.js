'use strict';

const express = require('express');
const LLMCost = require('../models/llmCosts.model');
const { asyncHandler, success, failure } = require('../utils/http');

const router = express.Router();

/**
 * escapeRegex
 * Escapes special characters in a string for safe use within a RegExp source.
 * Local helper kept minimal to avoid importing extra utilities.
 */
// PUBLIC_INTERFACE
function escapeRegex(str) {
  /** Escapes regex meta characters for safe dynamic regex creation. */
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * PUBLIC_INTERFACE
 * GET /api/llm_costs
 * Returns raw/full documents from the 'llm_costs' collection (underscore), with optional organization_id filter,
 * server-side pagination, and stable default sort by timestamp desc (fallback created_at desc, then _id desc).
 * Response: { success: true, data, pagination: { page, limit, total, totalPages } }
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Prevent stale cache interfering with pagination responses
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.removeHeader?.('ETag');

    // Validate and coerce page and limit with sane caps
    const MAX_LIMIT = 200; // align with API contract cap
    let page = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);

    if (!Number.isFinite(page) || page < 1) page = 1;
    // Default limit to 20 as per general API docs; respect requested limit otherwise
    if (!Number.isFinite(limit) || limit < 1) limit = 20;
    if (limit > MAX_LIMIT) {
      // Enforce max rather than silently capping to avoid surprising frontend; return 400 to be explicit
      return failure(res, `limit must be <= ${MAX_LIMIT}`, 400);
    }

    const skip = (page - 1) * limit;

    // Optional filter by organization/tenant (validated)
    const rawOrg = (req.query.organization_id || req.query.tenant_id || '').toString().trim();
    const filter = {};
    if (rawOrg) {
      const rx = new RegExp(`^${escapeRegex(rawOrg)}$`, 'i');
      filter.$or = [
        { organization_id: rawOrg },
        { organization_id: { $regex: rx } },
        { tenant_id: rawOrg },
        { tenant_id: { $regex: rx } },
      ];
    }

    // Consistent sort: prefer timestamp desc, then created_at desc, finally _id desc
    const sort = { timestamp: -1, created_at: -1, _id: -1 };

    // Execute count + page
    const [total, docs] = await Promise.all([
      LLMCost.countDocuments(filter),
      LLMCost.find(filter).sort(sort).skip(skip).limit(limit).lean().exec(),
    ]);

    const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

    // Diagnostic headers (CORS-safe; existing middleware manages CORS)
    try {
      res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
      res.setHeader('X-LLM-COSTS-Total', String(total));
      res.setHeader('x-llm-page', String(page));
      res.setHeader('x-llm-limit', String(limit));
      res.setHeader('x-llm-sort', JSON.stringify(sort));
      if (rawOrg) res.setHeader('x-effective-tenant', rawOrg);
    } catch {}

    // Handle out-of-range pages by returning empty data but respecting requested pagination
    const data = skip >= total ? [] : Array.isArray(docs) ? docs : [];

    // Envelope with pagination metadata
    const pagination = {
      page,
      limit,
      total,
      totalPages,
    };

    // Return response matching requested schema: { data, pagination }
    // Use success() to keep consistent envelope and include pagination under meta for compatibility.
    const meta = {
      ...pagination,
      ...(rawOrg ? { organization_id: rawOrg } : {}),
    };

    return res.status(200).json({
      success: true,
      data,
      pagination,
      meta,
    });
  })
);

module.exports = router;
