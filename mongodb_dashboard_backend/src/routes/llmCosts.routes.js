'use strict';

const express = require('express');
const router = express.Router();
const { listLLMCosts } = require('../controllers/llmCosts.controller');
// Note: This router is mounted at /api/llm-costs by the base router (routes/index.js).
// The root path '/' here corresponds to GET /api/llm-costs.

/**
// PUBLIC_INTERFACE
 * GET /api/llm-costs
 * Optimized listing with:
 * - Early index-backed sort/skip/limit on { organization_id, _id } or createdAt
 * - Projection of only required fields
 * - Batched user enrichment by string UUIDs
 * - Env-guarded profiling (LLM_COSTS_PROFILE=true) and query timeout (LLM_COSTS_QUERY_TIMEOUT_MS)
 * - Diagnostic headers: X-DB-Connected, X-Org-Filter, X-Query-Duration
 */
router.get('/', (req, res, next) => {
  // Enforce safe defaults and caps before hitting controller
  const maxLimit = 100;
  // Normalize page and limit
  const q = req.query || {};
  const page = q.page ? parseInt(q.page, 10) : 1;
  let limit = q.limit ? parseInt(q.limit, 10) : 20;
  if (!Number.isFinite(limit) || limit <= 0) limit = 20;
  if (limit > maxLimit) limit = maxLimit;
  req.query.page = Number.isFinite(page) && page >= 1 ? String(page) : '1';
  req.query.limit = String(limit);

  // Optional: honor sort param but default to _id desc for index-backed
  if (!q.sort) req.query.sort = '-_id';

  // Mark that this route applied safety guards (debugging aid)
  try { res.set('X-LlmCosts-Guards', `page=${req.query.page};limit=${req.query.limit}`); } catch {}

  return listLLMCosts(req, res, next);
});
// Allow HEAD for quick checks of readiness and meta
router.head('/', listLLMCosts);

module.exports = router;
