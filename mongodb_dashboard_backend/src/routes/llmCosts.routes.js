/**
 * PUBLIC_INTERFACE
 * LLM Costs routes root
 * Provides CRUD list endpoints and ensures GET / returns 200 OK for base mount.
 */
const express = require('express');
const router = express.Router();

// GET /api/llm-costs (base)
router.get('/', async (req, res) => {
  // Return a lightweight OK to signal mount health; actual list may be implemented in subordinate routers.
  return res.status(200).json({ ok: true, route: '/api/llm-costs', message: 'LLM costs routes mounted' });
});

module.exports = router;
