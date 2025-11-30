const express = require('express');
const router = express.Router();
const { listLLMCosts } = require('../controllers/llmCosts.controller');

/**
 * PUBLIC_INTERFACE
 * GET /api/llm-costs
 * Lists LLM cost documents from the 'llm-costs' collection.
 * Query:
 *  - page (int, default 1), limit (int, default 20, max 200)
 *  - sort (ignored in this minimal listing; defaults to _id desc)
 *  - filter (ignored to avoid arbitrary injection for this listing)
 *  - organization_id or tenant_id (optional exact match)
 * Returns envelope: { success, data, meta: { page, limit, total } }
 */
router.get('/', listLLMCosts);
// Allow HEAD for quick readiness/testing
router.head('/', listLLMCosts);

module.exports = router;
