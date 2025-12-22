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
    const filter = {};
    if (rawOrg) {
      // Build $or across exact and case-insensitive matches on organization_id and tenant_id
      const rx = new RegExp(`^${escapeRegex(rawOrg)}$`, 'i');
      filter.$or = [
        { organization_id: rawOrg },
        { organization_id: { $regex: rx } },
        { tenant_id: rawOrg },
        { tenant_id: { $regex: rx } },
      ];
    }

    // Stable default sort: newest first by _id
    const sort = { _id: -1 };

    // Execute count + page
    // IMPORTANT: Do NOT project away nested arrays; include users.projects.agents and top-level agents.
    // Include stored agent_name from llm_costs as-is (no derivation or utilities).
    const projection = {
      agents: 1,
      users: 1,
      'users.projects': 1,
      'users.projects.agents': 1,
      request_id: 1,
      session_id: 1,
      project_id: 1,
      timestamp: 1,
      created_at: 1,
      model: 1,
      model_version: 1,
      provider: 1,
      provider_status: 1,
      user_id: 1,
      organization_id: 1,
      tenant_id: 1,
      tokens_in: 1,
      tokens_out: 1,
      prompt: 1,
      completion: 1,
      cost_usd: 1,
      total_cost: 1,
      currency: 1,
      duration_ms: 1,
      status: 1,
      details: 1,
      agent_name: 1, // agent_name is passed through from the collection as-is
    };

    const [total, docs] = await Promise.all([
      LLMCost.countDocuments(filter),
      LLMCost.find(filter, projection).sort(sort).skip(skip).limit(limit).lean().exec(),
    ]);

    // Minimal diagnostic headers
    try {
      res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
      res.setHeader('X-LLM-COSTS-Total', String(total));
    } catch {}

    // Envelope with raw docs untouched, including stored agent_name
    return success(
      res,
      Array.isArray(docs) ? docs : [],
      {
        page,
        limit,
        total,
        ...(rawOrg ? { organization_id: rawOrg } : {}),
      },
      200
    );
  })
);

module.exports = router;
