/**
 * PUBLIC_INTERFACE
 * LLM Costs routes
 * GET / -> tenant-scoped listing with pagination and projections
 */
const express = require('express');
const router = express.Router();

const { listLLMCostsStd } = require('../controllers/llmCosts.list.controller');

// PUBLIC_INTERFACE
/**
 * GET /api/llm-costs
 * List LLM cost documents (tenant-scoped) with pagination.
 * Query params:
 *  - organization_id (alias tenant_id)
 *  - page (default 1)
 *  - limit (default 20, max 100)
 */
router.get('/', listLLMCostsStd);

// PUBLIC_INTERFACE
/**
 * GET /api/llm-costs/ping
 * A minimal health ping for CI/debugging to quickly validate that /api/llm-costs group is reachable.
 * Returns 200 OK with a timestamp.
 */
router.get('/ping', (req, res) => {
  const started = Date.now();
  try {
    res.set('X-Request-Id', req.traceId || '');
    if (req.tenantId) res.set('X-Applied-Tenant', String(req.tenantId));
  } catch {}
  const body = { ok: true, route: '/api/llm-costs/ping', ts: new Date().toISOString() };
  try { res.set('X-Route-Timing', String(Date.now() - started)); } catch {}
  return res.status(200).json(body);
});

module.exports = router;
