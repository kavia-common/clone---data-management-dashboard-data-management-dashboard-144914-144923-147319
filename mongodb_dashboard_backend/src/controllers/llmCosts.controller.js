'use strict';

const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * listLLMCosts
 * GET /api/llm-costs
 *
 * Purpose:
 *  - Return documents from 'llm-costs' collection with exact field names and no transformation/unwind.
 *  - Only project explicit fields: _id, organization_id, organization_name, organization_cost, users, project, projects, agents, timestamp, created_at, createdAt.
 *  - Optional exact filter organization_id=<value>. When omitted, return all documents.
 *  - Sort by _id desc. Add pagination (page, limit) and meta {page, limit, total}.
 *  - Use fast preflight count and maxTimeMS(8000).
 */
async function listLLMCosts(req, res, next) {
  try {
    // Accept organization_id also from alias tenant_id, respecting optional nature
    const { page: pageRaw, limit: limitRaw, organization_id: orgQ, tenant_id: tenantQ } = req.query;

    // Resolve optional organization filter (query/alias only; listing endpoint permits all-tenants)
    const orgFilter =
      (typeof orgQ === 'string' && orgQ.trim()) ||
      (typeof tenantQ === 'string' && tenantQ.trim()) ||
      undefined;

    // Pagination validation
    const page = Math.max(parseInt(pageRaw, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 20, 1), 200);
    const skip = (page - 1) * limit;

    // Build exact match: apply only if provided
    const match = {};
    if (orgFilter) {
      match.organization_id = String(orgFilter);
    }

    // Strict projection: exact fields from collection (no transforms/unwinds)
    const projection = {
      _id: 1,
      organization_id: 1,
      organization_name: 1,
      organization_cost: 1,
      users: 1,
      // Some datasets use `project` vs `projects`; expose both when present
      project: 1,
      projects: 1,
      agents: 1,
      // Include useful timestamps if present; still no computed transforms
      timestamp: 1,
      created_at: 1,
      createdAt: 1,
    };

    const maxTime = 8000;

    // Count respecting match
    const total = await LLMCost.find(match).setOptions({ maxTimeMS: maxTime }).countDocuments().exec();

    // Diagnostics headers
    try {
      if (orgFilter) res.set('X-LlmCosts-OrgFilter', String(orgFilter));
      res.set('X-Model-Collection', LLMCost.collection?.name || 'llm-costs');
      res.set('X-ListEnvelope', 'true');
      res.set('X-Query-MaxTimeMS', String(maxTime));
    } catch (_) {}

    // Always return ListEnvelope for this endpoint
    if (!total) {
      return res.status(200).json({ success: true, data: [], meta: { page, limit, total: 0 } });
    }

    // Fetch paginated data sorted by _id desc (stable, no unwinds)
    const data = await LLMCost.find(match, projection)
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit)
      .setOptions({ maxTimeMS: maxTime })
      .lean()
      .exec();

    return res.status(200).json({
      success: true,
      data,
      meta: { page, limit, total },
    });
  } catch (err) {
    // Handle timeouts gracefully
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
