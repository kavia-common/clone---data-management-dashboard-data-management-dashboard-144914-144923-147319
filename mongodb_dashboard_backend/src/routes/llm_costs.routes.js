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
    const [total, rawDocs] = await Promise.all([
      LLMCost.countDocuments(filter),
      LLMCost.find(filter).sort(sort).skip(skip).limit(limit).lean().exec(),
    ]);

    // Derive agents and top-level agent_name using robust utility with cost-aware ranking
    const { deriveAgentName, extractDistinctAgentNames } = require('../utils/agentName');
    const docs = Array.isArray(rawDocs) ? rawDocs.map((d) => {
      try {
        const agentsList = extractDistinctAgentNames(d);
        const agentName = deriveAgentName(d);
        return { ...d, agents: agentsList, agent_name: agentName };
      } catch {
        return { ...d, agents: [], agent_name: null };
      }
    }) : [];

    // Minimal diagnostic headers
    try {
      res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
      res.setHeader('X-LLM-COSTS-Total', String(total));
      const agentsFound = docs.reduce((acc, d) => acc + (Array.isArray(d.agents) ? d.agents.length : 0), 0);
      res.setHeader('X-LLM-COSTS-Agents-Found', String(agentsFound));
      const derivedCount = docs.reduce((acc, d) => acc + (typeof d.agent_name === 'string' && d.agent_name ? 1 : 0), 0);
      res.setHeader('x-agents-derived', String(derivedCount));
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
      },
      200
    );
  })
);

module.exports = router;
