'use strict';

/**
 * PUBLIC_INTERFACE
 * getLlmCostsLastDiagnostics
 * Returns the last captured diagnostics snapshot for GET /api/llm-costs.
 * This endpoint does not execute any DB queries; it only returns in-memory data
 * captured by the listLlmCosts handler.
 */
const { getLastLlmCostsDiagnostics } = require('./llmCosts.list.controller');

async function getLlmCostsLastDiagnostics(req, res) {
  try {
    const last = getLastLlmCostsDiagnostics();
    return res.status(200).json({
      success: true,
      data: last,
      note: 'Enable DEBUG_LLMCOSTS_EXPLAIN=1 to include explain summaries in the snapshot.',
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to read diagnostics' });
  }
}

module.exports = { getLlmCostsLastDiagnostics };
