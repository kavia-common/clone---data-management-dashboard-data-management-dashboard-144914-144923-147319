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

// GET /api/llm-costs
router.get('/', asyncHandler(listLlmCosts));

module.exports = router;
