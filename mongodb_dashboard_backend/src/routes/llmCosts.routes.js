'use strict';

const express = require('express');
const router = express.Router();
const { listLLMCosts } = require('../controllers/llmCosts.controller');

// PUBLIC_INTERFACE
// GET /api/llm-costs — bounded, deterministic listing with diagnostic headers
router.get('/', listLLMCosts);
// Allow HEAD for quick checks of readiness and meta
router.head('/', listLLMCosts);

module.exports = router;
