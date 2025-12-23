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

    // Derive agent_name deterministically from nested users[].projects[].agents[].agent_name
    const docs = Array.isArray(rawDocs)
      ? rawDocs.map((d) => {
          try {
            const usersArr = Array.isArray(d?.users) ? d.users : [];
            const projectsNested = usersArr.map((u) =>
              Array.isArray(u?.projects) ? u.projects : []
            );
            const projectsFlat = projectsNested.flat();
            const agentsFlat = projectsFlat.flatMap((p) =>
              Array.isArray(p?.agents) ? p.agents : []
            );

            // Collect candidate names from agent_name then fallback to name
            const candidates = agentsFlat
              .map((a) => (typeof a?.agent_name === 'string' && a.agent_name.trim()
                ? a.agent_name.trim()
                : typeof a?.name === 'string' && a.name.trim()
                ? a.name.trim()
                : null))
              .filter((n) => typeof n === 'string' && n.length > 0);

            // Distinct set
            const distinct = Array.from(new Set(candidates));
            // Deterministic rule:
            // - if multiple names exist, choose the first non-empty alphabetical name
            // - if none exist, set to null
            let agent_name = null;
            if (distinct.length > 0) {
              const sorted = [...distinct].sort((a, b) =>
                a.localeCompare(b, undefined, { sensitivity: 'base' })
              );
              agent_name = sorted[0] || null;
            }

            return { ...d, agent_name };
          } catch {
            return { ...d, agent_name: null };
          }
        })
      : [];

    // Minimal diagnostic headers
    try {
      res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
      res.setHeader('X-LLM-COSTS-Total', String(total));
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
