'use strict';

const express = require('express');
const LLMCost = require('../models/llmCosts.model');
const { asyncHandler, success } = require('../utils/http');

const router = express.Router();

/**
 * escapeRegex
 * Escapes special characters in a string for safe use within a RegExp source.
 * Local helper kept minimal to avoid importing extra utilities.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * PUBLIC_INTERFACE
 * GET /api/llm_costs
 * Returns raw/full documents from the 'llm_costs' collection (underscore), with optional organization_id filter,
 * server-side pagination, and stable default sort by timestamp desc (fallback created_at desc, then _id desc).
 * Response: { success: true, data: [<raw docs>], pagination: { page, limit, total, totalPages } }
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Validate and coerce page and limit with sane caps
    const MAX_LIMIT = 200; // align with API contract cap
    let page = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);

    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = 10;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;

    const skip = (page - 1) * limit;

    // Optional filter by organization/tenant
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

    // Note: success() helper previously returned { success, data, meta }, keep compatible but add pagination key
    // We'll pass pagination in meta and also return a top-level pagination for frontend ergonomics
    const meta = {
      ...pagination,
      ...(rawOrg ? { organization_id: rawOrg } : {}),
    };

    const body = { pagination }; // will be merged by success() as meta, but also include pagination explicitly if success() doesn't add it
    return success(res, data, meta, 200, body);
  })
);

module.exports = router;
