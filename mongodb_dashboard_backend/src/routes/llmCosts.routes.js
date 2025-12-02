'use strict';

const express = require('express');
const { listLlmCosts } = require('../controllers/llmCosts.list.controller');
// Use the actual diagnostics controller file present in the repository
const { getLastLlmCostsDiagnostics } = require('../controllers/llmCosts.diagnostics.last.controller');

// Existing controllers if any can be required here for other methods
// const { getById, createCost, updateCost, deleteCost } = require('../controllers/llmCosts.id.controller');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/llm-costs
 * List LLM cost records (tabular)
 */
router.get('/', listLlmCosts);

/**
 * PUBLIC_INTERFACE
 * GET /api/llm-costs/diagnostics/last
 * Lightweight endpoint to read the last diagnostics snapshot captured by the list handler.
 */
router.get('/diagnostics/last', getLastLlmCostsDiagnostics);

// Example placeholders for id-based CRUD if needed later
// router.get('/:id', getById);
// router.post('/', createCost);
// router.put('/:id', updateCost);
// router.delete('/:id', deleteCost);

module.exports = router;
