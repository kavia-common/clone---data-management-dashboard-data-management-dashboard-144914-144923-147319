'use strict';

const { getDiagnosticsStore } = require('../utils/llmCostsDiagnostics');

/**
 * PUBLIC_INTERFACE
 * getLastLlmCostsDiagnostics
 * GET /api/llm-costs/diagnostics/last
 * Returns the last captured diagnostics snapshot for the /api/llm-costs list endpoint.
 */
async function getLastLlmCostsDiagnostics(req, res) {
  const last = getDiagnosticsStore().get();
  return res.status(200).json({ success: true, last });
}

module.exports = { getLastLlmCostsDiagnostics };
