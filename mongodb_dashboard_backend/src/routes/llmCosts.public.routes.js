'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { listLlmCosts } = require('../controllers/llmCosts.fallback.controller');

/**
 * PUBLIC_INTERFACE
 * llmCosts.public.routes
 * Exposes only the GET / (list) path of LLM costs with header/query tenant support (no JWT required),
 * enforcing exact tenant filter and standardized envelope/diagnostic headers.
 */
const router = express.Router();

// Disable caching explicitly at route level to prevent proxies from caching
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  try { res.removeHeader('ETag'); } catch (_){}
  next();
});

// GET /api/llm-costs
router.get('/', asyncHandler(listLlmCosts));

module.exports = router;
