'use strict';

const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * listLLMCosts
 * GET /api/llm-costs
 *
 * Purpose:
 *  - Return documents from 'llm-costs' collection with exact field names and no transformation/unwind.
 *  - Only project explicit fields: _id, organization_id, organization_name, organization_cost, users, projects, agents.
 *  - Optional exact filter organization_id=<value>. When omitted, return all documents.
 *  - Sort by _id desc. Add pagination (page, limit) and meta {page, limit, total}.
 *  - Use fast preflight count and maxTimeMS(8000).
 */
async function listLLMCosts(req, res, next) {
  try {
    const { page: pageRaw, limit: limitRaw } = req.query;
    const orgFilter = typeof req.query.organization_id === 'string' && req.query.organization_id.trim()
      ? req.query.organization_id.trim()
      : undefined;

    // Validate pagination
    const page = Math.max(parseInt(pageRaw, 10) || 1, 1);
    const limitCapped = Math.min(Math.max(parseInt(limitRaw, 10) || 20, 1), 200);
    const skip = (page - 1) * limitCapped;

    // Build exact match
    const match = {};
    if (orgFilter) {
      match.organization_id = orgFilter; // exact match
    }

    // Projection: strict exact fields
    const projection = {
      _id: 1,
      organization_id: 1,
      organization_name: 1,
      organization_cost: 1, // keep string currency values as-is (e.g., "$3005.442509")
      users: 1,
      projects: 1,
      agents: 1,
    };

    const maxTime = 8000;

    // Fast total count first (respecting match)
    const countQuery = LLMCost.find(match).setOptions({ maxTimeMS: maxTime }).countDocuments();
    const total = await countQuery.exec();

    // If no matches, return empty envelope with minimal log header
    if (!total) {
      try {
        res.set('X-LlmCosts-Notice', 'No matches for provided filter');
        if (orgFilter) res.set('X-LlmCosts-OrgFilter', orgFilter);
      } catch {}
      return res.status(200).json({
        success: true,
        data: [],
        meta: { page, limit: limitCapped, total: 0 },
      });
    }

    // Fetch page with sort by _id desc and strict projection. Use lean() for speed.
    const cursor = LLMCost.find(match, projection)
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limitCapped)
      .setOptions({ maxTimeMS: maxTime, allowDiskUse: true })
      .lean();

    const data = await cursor.exec();

    // Response envelope
    try {
      res.set('X-ListEnvelope', 'true');
      res.set('X-Query-MaxTimeMS', String(maxTime));
    } catch {}
    return res.status(200).json({
      success: true,
      data,
      meta: { page, limit: limitCapped, total },
    });
  } catch (err) {
    // Timeout guard
    if (err && (err.code === 50 || /exceeded time limit/i.test(String(err.message || '')))) {
      return res.status(504).json({
        success: false,
        message: 'Query exceeded time limit.',
      });
    }
    return next(err);
  }
}

module.exports = {
  listLLMCosts,
};
