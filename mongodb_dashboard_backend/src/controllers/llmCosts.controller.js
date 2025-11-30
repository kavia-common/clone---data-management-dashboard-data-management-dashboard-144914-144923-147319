'use strict';

const mongoose = require('mongoose');
const LLMCost = require('../models/llmCosts.model');
const { isDbConnected } = require('../config/db');

/**
 * PUBLIC_INTERFACE
 * listLLMCosts
 * GET /api/llm-costs
 *
 * Purpose:
 *  - Return documents from 'llm-costs' collection with exact field names and no transformation/unwind.
 *  - Optional exact filter organization_id=<value> (alias tenant_id). When omitted, return all documents.
 *  - Sort by _id desc. Pagination (page, limit) with sane defaults/caps. Envelope: { success, data, meta }.
 * Behavior:
 *  - If DB not connected, early return 200 with empty data and meta, include header X-DB-Connected:false.
 *  - If required env vars are missing (MONGODB_URI or MONGODB_DB when explicitly required), respond 503 with clear message.
 *  - Add timing logs and headers; bound queries with maxTimeMS(8000) and limit cap.
 */
async function listLLMCosts(req, res, next) {
  const t0 = Date.now();
  try {
    const {
      page: pageRaw,
      limit: limitRaw,
      organization_id: orgQ,
      tenant_id: tenantQ,
    } = req.query;

    // Validate essential env for clarity when failing in demo/preview
    const hasUri = !!process.env.MONGODB_URI;
    if (!hasUri) {
      res.set('X-DB-Connected', 'false');
      res.set('X-Reason', 'MONGODB_URI not set');
      return res.status(503).json({
        success: false,
        status: 'db-not-configured',
        message: 'Database URI is not configured. Set MONGODB_URI in environment.',
      });
    }

    // Early return if not connected to avoid hanging 504
    if (!isDbConnected()) {
      try {
        res.set('X-DB-Connected', 'false');
      } catch (_) {}
      return res.status(200).json({
        success: true,
        data: [],
        meta: { page: 1, limit: 0, total: 0 },
      });
    }

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
        res.set('X-Query-MaxTimeMS', '2000');
      } catch (_) {}
      return res.status(200).end();
    }

    const tCount0 = Date.now();
    // Total count for meta (bounded)
    const total = await LLMCost.countDocuments(match).maxTimeMS(maxTime).exec();
    const tCount1 = Date.now();

    // Diagnostics headers (non-breaking)
    try {
      if (orgFilter) res.set('X-LlmCosts-OrgFilter', String(orgFilter));
      res.set('X-Model-Collection', LLMCost.collection?.name || 'llm-costs');
      res.set('X-ListEnvelope', 'true');
      res.set('X-Query-MaxTimeMS', String(maxTime));
      res.set('X-DB-Connected', 'true');
      res.set('X-Query-CountMs', String(tCount1 - tCount0));
    } catch (_) {}

    // Short-circuit empty
    if (!total) {
      const t1 = Date.now();
      try { res.set('X-Query-TotalMs', String(t1 - t0)); } catch (_) {}
      return res.status(200).json({
        success: true,
        data: [],
        meta: { page, limit, total: 0 },
      });
    }

    const tFind0 = Date.now();
    // Fetch page, sorted by _id desc
    const dataRaw = await LLMCost.find(match, projection)
      .sort({ _id: -1 }) // stable and indexed
      .skip(skip)
      .limit(limit)
      .maxTimeMS(maxTime)
      .lean()
      .exec();
    const tFind1 = Date.now();

    // Normalize to exact fields required; preserve optional fields if present
    const data = (Array.isArray(dataRaw) ? dataRaw : []).map((doc) => ({
      _id: doc._id,
      organization_id: doc.organization_id ?? doc.tenant_id ?? null, // prefer organization_id
      organization_name: doc.organization_name ?? null,
      organization_cost: doc.organization_cost ?? doc.total_cost ?? null,
      users: Array.isArray(doc.users) ? doc.users : [],
      projects: Array.isArray(doc.projects) ? doc.projects : (Array.isArray(doc.project) ? doc.project : []),
      agents: Array.isArray(doc.agents) ? doc.agents : [],
    }));

    const t1 = Date.now();
    try {
      res.set('X-Query-FindMs', String(tFind1 - tFind0));
      res.set('X-Query-TotalMs', String(t1 - t0));
    } catch (_) {}

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
