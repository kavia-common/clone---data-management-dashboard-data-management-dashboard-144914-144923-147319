'use strict';

/**
 * PUBLIC_INTERFACE
 * LLM Costs routes
 * Notes:
 * - Supports limit=all and all=true to fetch up to MAX_ALL_LIMIT records in a single query.
 * - Tenant scoping is required via Authorization token or x-organization-id header (or query alias).
 * - The controller applies a strict timestamp window with max days and internal timeouts to prevent 504s.
 */
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

/**
 * PUBLIC_INTERFACE
 * GET /api/llm-costs/diagnostics
 * Minimal help/diagnostics endpoint describing available paths and returning last snapshot.
 */
router.get('/diagnostics', async (req, res) => {
  try {
    const { getDiagnosticsStore } = require('../utils/llmCostsDiagnostics');
    const last = getDiagnosticsStore().get();
    return res.status(200).json({
      success: true,
      routes: [
        { path: '/api/llm-costs', method: 'GET', description: 'List LLM cost records (tabular envelope)' },
        { path: '/api/llm-costs/diagnostics/last', method: 'GET', description: 'Return last captured diagnostics from a list execution' },
      ],
      last,
      note: 'Enable DEBUG_LLMCOSTS_EXPLAIN=1 to capture explain summaries.',
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'diagnostics_unavailable', message: err?.message || 'Unknown error' });
  }
});

// Example placeholders for id-based CRUD if needed later
// router.get('/:id', getById);
// router.post('/', createCost);
// router.put('/:id', updateCost);
// router.delete('/:id', deleteCost);

module.exports = router;
