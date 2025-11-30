'use strict';

const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * listLLMCosts
 * GET /api/llm-costs
 *
 * Purpose:
 *  - Return documents from 'llm-costs' collection with exact field names and no transformation/unwind.
 *  - Optional exact filter organization_id=<value> (alias tenant_id). When omitted, return all documents.
 *  - Sort by _id desc. Pagination (page, limit) with sane defaults/caps. Envelope: { success, data, meta }.
 */
async function listLLMCosts(req, res, next) {
  try {
    const {
      page: pageRaw,
      limit: limitRaw,
      organization_id: orgQ,
      tenant_id: tenantQ,
    } = req.query;

    // Resolve optional organization filter
    const orgFilter =
      (typeof orgQ === 'string' && orgQ.trim()) ||
      (typeof tenantQ === 'string' && tenantQ.trim()) ||
      undefined;

    // Pagination: defaults and caps
    const DEFAULT_LIMIT = 20;
    const HARD_CAP = 200;
    const page = Math.max(parseInt(pageRaw, 10) || 1, 1);
    const requestedLimit = Math.max(parseInt(limitRaw, 10) || DEFAULT_LIMIT, 1);
    const limit = Math.min(requestedLimit, HARD_CAP);
    const skip = (page - 1) * limit;

    // Apply exact match when provided
    const match = {};
    if (orgFilter) {
      match.organization_id = String(orgFilter);
    }

    // Projection: return as stored; do not transform or unwind
    // Keep a permissive projection so we don't accidentally exclude stored fields users/projects/agents
    const projection = {
      _id: 1,
      organization_id: 1,
      organization_name: 1,
      organization_cost: 1,
      users: 1,
      projects: 1,
      project: 1,
      agents: 1,
      created_at: 1,
      createdAt: 1,
      timestamp: 1,
    };

    const maxTime = 8000;

    // Fast path: HEAD returns only headers/meta with zero body for quick checks
    if (req.method === 'HEAD') {
      const totalHead = await LLMCost.countDocuments(match).maxTimeMS(2000).exec();
      try {
        if (orgFilter) res.set('X-LlmCosts-OrgFilter', String(orgFilter));
        res.set('X-Model-Collection', LLMCost.collection?.name || 'llm-costs');
        res.set('X-ListEnvelope', 'true');
        res.set('X-Total-Count', String(totalHead));
      } catch (_) {}
      return res.status(200).end();
    }

    // Total count for meta
    const total = await LLMCost.countDocuments(match).maxTimeMS(maxTime).exec();

    // Diagnostics headers (non-breaking)
    try {
      if (orgFilter) res.set('X-LlmCosts-OrgFilter', String(orgFilter));
      res.set('X-Model-Collection', LLMCost.collection?.name || 'llm-costs');
      res.set('X-ListEnvelope', 'true');
      res.set('X-Query-MaxTimeMS', String(maxTime));
    } catch (_) {}

    // Short-circuit empty
    if (!total) {
      return res.status(200).json({
        success: true,
        data: [],
        meta: { page, limit, total: 0 },
      });
    }

    // Fetch page, sorted by _id desc
    const dataRaw = await LLMCost.find(match, projection)
      .sort({ _id: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .maxTimeMS(maxTime)
      .lean()
      .exec();

    // Normalize to exact fields required; preserve optional fields if present
    const data = (Array.isArray(dataRaw) ? dataRaw : []).map((doc) => ({
      _id: doc._id,
      organization_id: doc.organization_id ?? doc.tenant_id, // prefer organization_id
      organization_name: doc.organization_name ?? null,
      organization_cost: doc.organization_cost ?? doc.total_cost ?? null,
      users: Array.isArray(doc.users) ? doc.users : [],
      projects: Array.isArray(doc.projects) ? doc.projects : (Array.isArray(doc.project) ? doc.project : []),
      agents: Array.isArray(doc.agents) ? doc.agents : [],
    }));

    return res.status(200).json({
      success: true,
      data,
      meta: { page, limit, total },
    });
  } catch (err) {
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
