const express = require('express');
const router = express.Router();
const { listLLMCosts } = require('../controllers/llmCosts.controller');

/**
 * PUBLIC_INTERFACE
 * GET /api/llm-costs
 * Lists LLM cost documents from the 'llm-costs' collection using a fast, bounded query.
 * Behavior:
 *  - Uses find() with exact match on organization_id when provided; otherwise list all.
 *  - Sorts by _id desc; applies limit cap and maxTimeMS(8000).
 *  - No $unwind or heavy aggregations.
 *  - Returns ListEnvelope: { success, data, meta: { page, limit, total } }
 *  - When DB not connected, returns 200 with empty data (and X-DB-Connected:false header).
 *  - When env missing (MONGODB_URI), returns 503 with clear message.
 * Validation targets:
 *  - organization_id=T0015 and organization_id=b2c should work without timeouts.
 */
router.get('/', listLLMCosts);
// Allow HEAD for quick readiness/testing
router.head('/', listLLMCosts);

module.exports = router;
