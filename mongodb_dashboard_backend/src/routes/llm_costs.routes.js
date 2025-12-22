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
 * server-side pagination, and stable default sort by _id desc. Currency strings and nested arrays are preserved as-is.
 * Response: { success: true, data: [<raw docs>], meta: { page, limit, total, organization_id? } }
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Pagination with sane defaults and clamped max
    const maxLimit = 100;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), maxLimit);
    const skip = (page - 1) * limit;

    // Optional broadened filter by organization_id (alias: tenant_id)
    const rawOrg = (req.query.organization_id || req.query.tenant_id || '').toString().trim();

    // Optional user filter
    const rawUserId = (req.query.user_id || '').toString().trim();

    const filter = {};
    if (rawOrg) {
      // Build $or across exact and case-insensitive matches on organization_id and tenant_id
      const rxOrg = new RegExp(`^${escapeRegex(rawOrg)}$`, 'i');
      filter.$or = [
        { organization_id: rawOrg },
        { organization_id: { $regex: rxOrg } },
        { tenant_id: rawOrg },
        { tenant_id: { $regex: rxOrg } },
      ];
    }

    if (rawUserId) {
      // User id may be stored as string or ObjectId rendered as string; use case-insensitive exact match
      const rxUser = new RegExp(`^${escapeRegex(rawUserId)}$`, 'i');
      filter.$and = (filter.$and || []).concat([
        {
          $or: [
            { user_id: rawUserId },
            { user_id: { $regex: rxUser } },
            { 'user.id': rawUserId },
            { 'user.id': { $regex: rxUser } },
            { 'user._id': rawUserId },
            { 'user._id': { $regex: rxUser } },
          ],
        },
      ]);
    }

    // Stable default sort: newest first by _id (preserve existing behavior)
    const sort = { _id: -1 };

    // Execute count + page
    const [total, docs] = await Promise.all([
      LLMCost.countDocuments(filter),
      LLMCost.find(filter).sort(sort).skip(skip).limit(limit).lean().exec(),
    ]);

    // Minimal diagnostic headers
    try {
      res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
      res.setHeader('X-LLM-COSTS-Total', String(total));
      if (rawUserId) res.setHeader('X-LLM-COSTS-User', rawUserId);
    } catch {}

    // Envelope with raw docs untouched
    return success(
      res,
      Array.isArray(docs) ? docs : [],
      {
        page,
        limit,
        total,
        ...(rawOrg ? { organization_id: rawOrg } : {}),
        ...(rawUserId ? { user_id: rawUserId } : {}),
      },
      200
    );
  })
);

module.exports = router;
