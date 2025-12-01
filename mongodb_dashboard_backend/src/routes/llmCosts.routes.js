'use strict';

const express = require('express');
const router = express.Router();
const { listLLMCosts } = require('../controllers/llmCosts.controller');

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
router.get('/', listLLMCosts);
// Allow HEAD for quick checks of readiness and meta
router.head('/', listLLMCosts);

module.exports = router;
