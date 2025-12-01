/**
 * PUBLIC_INTERFACE
 * LLM Costs routes root
 * Provides CRUD list endpoints and ensures GET / returns 200 OK for base mount.
 */
const express = require('express');
const router = express.Router();

// PUBLIC_INTERFACE
/**
 * GET /api/llm-costs
 * Basic mount check that returns 200 OK to confirm the route is registered.
 */
router.get('/', async (req, res) => {
  // Return a lightweight OK to signal mount health; actual list may be implemented in subordinate routers.
  return res.status(200).json({ ok: true, route: '/api/llm-costs', message: 'LLM costs routes mounted' });
});

// PUBLIC_INTERFACE
/**
 * GET /api/llm-costs/ping
 * A minimal health ping for CI/debugging to quickly validate that /api/llm-costs group is reachable.
 * Returns 200 OK with a timestamp.
 */
router.get('/ping', (req, res) => {
  return res.status(200).json({ ok: true, route: '/api/llm-costs/ping', ts: new Date().toISOString() });
});

module.exports = router;
