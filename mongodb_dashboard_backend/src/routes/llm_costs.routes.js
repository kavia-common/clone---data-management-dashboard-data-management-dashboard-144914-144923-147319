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
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * isPositiveInt
 * Validates that a value is a positive integer.
 */
function isPositiveInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0;
}

/**
 * PUBLIC_INTERFACE
 * GET /api/llm_costs
 * Returns raw/full documents from the 'llm_costs' collection (underscore), with optional organization_id filter,
 * server-side pagination, and stable default sort by _id desc. Currency strings and nested arrays are preserved as-is.
 * Response: { success: true, data: [<raw docs>], meta: { page, limit, total, organization_id? } }
 *
 * Validation and behavior:
 * - page defaults to 1; limit defaults to 10; limit is clamped to maxLimit (100). Non-integer/<=0 cause 400.
 * - organization_id/tenant_id accepted as strings only; non-string values cause 400.
 * - Defensive try/catch around DB operations to avoid 500 on data shape issues; returns consistent 500 payload when unexpected.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Pagination validation with sane defaults and clamped max
    const maxLimit = 100;

    const pageRaw = req.query.page ?? '1';
    const limitRaw = req.query.limit ?? '10';

    if (!isPositiveInt(pageRaw)) {
      return res.status(400).json({ success: false, message: 'Invalid page; must be a positive integer' });
    }
    if (!isPositiveInt(limitRaw)) {
      return res.status(400).json({ success: false, message: 'Invalid limit; must be a positive integer' });
    }

    const page = Math.max(parseInt(pageRaw, 10), 1);
    const limit = Math.min(parseInt(limitRaw, 10), maxLimit);
    const skip = (page - 1) * limit;

    // Optional broadened filter by organization_id (alias: tenant_id)
    const orgParam = req.query.organization_id ?? req.query.tenant_id ?? '';
    if (orgParam !== '' && typeof orgParam !== 'string') {
      return res.status(400).json({ success: false, message: 'organization_id/tenant_id must be a string' });
    }
    const rawOrg = String(orgParam || '').trim();

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

    // Execute count + page with defensive handling
    let total = 0;
    let rawDocs = [];
    try {
      [total, rawDocs] = await Promise.all([
        LLMCost.countDocuments(filter),
        LLMCost.find(filter).sort(sort).skip(skip).limit(limit).lean().exec(),
      ]);
    } catch (err) {
      // If the filter contained something unexpected or model misconfig, surface 400 where appropriate
      const status = /CastError|ObjectId|BSON|E11000|ValidationError/i.test(String(err?.name) + ' ' + String(err?.message))
        ? 400
        : 500;
      return res.status(status).json({
        success: false,
        message: status === 400 ? 'Invalid query parameters or filter' : 'Internal server error',
        details: process.env.NODE_ENV !== 'production' ? String(err?.message || err) : undefined,
      });
    }

    // Derive agents for each document from nested users[].projects[].agents[] if present
    // - Defensive against missing arrays/fields
    // - Collect unique agent_name values (fallback to name), sorted ascending for stable UI
    // - Keep backward compatibility by preserving all existing fields
    const docs = Array.isArray(rawDocs)
      ? rawDocs.map((d) => {
          try {
            const usersArr = Array.isArray(d && d.users) ? d.users : [];
            const agentNames = [];

            for (const u of usersArr) {
              const projects = Array.isArray(u && u.projects) ? u.projects : [];
              for (const p of projects) {
                const agents = Array.isArray(p && p.agents) ? p.agents : [];
                for (const a of agents) {
                  const n = (a && (a.agent_name || a.name)) || null;
                  if (typeof n === 'string' && n.trim().length > 0) {
                    agentNames.push(n.trim());
                  }
                }
              }
            }

            // De-duplicate and sort
            const distinctSorted = Array.from(new Set(agentNames)).sort((a, b) =>
              String(a).localeCompare(String(b))
            );

            // Backward compatibility: also expose a single agent_name if only one exists
            // without removing any existing fields.
            const agent_name =
              distinctSorted.length === 1 ? distinctSorted[0] : d.agent_name || undefined;

            // Return with new agents array and optional agent_name (existing fields preserved)
            return {
              ...d,
              ...(agent_name ? { agent_name } : {}),
              agents: distinctSorted,
            };
          } catch {
            return { ...d, agents: [] };
          }
        })
      : [];

    // Minimal diagnostic headers
    try {
      res.setHeader('X-LLM-COSTS-Collection', LLMCost.collection?.collectionName || 'llm_costs');
      res.setHeader('X-LLM-COSTS-Total', String(total));
      if (rawOrg) res.setHeader('x-effective-tenant', rawOrg);
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
