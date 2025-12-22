'use strict';
/**
 * PUBLIC_INTERFACE
 * Public routes for /api/llm-costs (hyphen).
 * Implements GET / that returns a paginated envelope from the fallback controller with diagnostics.
 */
const express = require('express');
const { listLlmCosts } = require('../controllers/llmCosts.fallback.controller');

const router = express.Router();

// PUBLIC_INTERFACE
// GET /api/llm-costs
// Returns 200 with { success, data, meta } or empty list when no records.
router.get('/', listLlmCosts);

module.exports = router;
