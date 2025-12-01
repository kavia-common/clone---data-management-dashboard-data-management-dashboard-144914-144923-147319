'use strict';

const express = require('express');
const fetch = require('node-fetch');

/**
 * PUBLIC_INTERFACE
 * Dev/test routes
 * Provides a lightweight server-side smoke test for LLM costs aggregation to verify non-empty data for b2c.
 */
const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/dev/test-llm-costs-b2c
 * Calls the local /api/llm-costs?organization_id=b2c&page=1&limit=10 and returns pass/fail with meta.
 */
router.get('/test-llm-costs-b2c', async (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const url = `${base}/api/llm-costs?organization_id=b2c&page=1&limit=10`;
  const started = Date.now();
  try {
    const r = await fetch(url, { headers: { 'accept': 'application/json' } });
    const json = await r.json();
    const ok = Array.isArray(json?.data) && json.data.length > 0;
    return res.status(200).json({
      success: ok,
      checked: 'GET /api/llm-costs?organization_id=b2c&page=1&limit=10',
      nonEmpty: ok,
      sample: ok ? json.data.slice(0, 3) : [],
      meta: json?.meta || null,
    });
  } catch (err) {
    return res.status(200).json({
      success: false,
      error: err?.message || String(err),
      took_ms: Date.now() - started,
    });
  }
});

module.exports = router;
