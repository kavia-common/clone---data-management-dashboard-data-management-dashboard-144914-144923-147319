'use strict';

const { getDiagnosticsStore } = require('../utils/llmCostsDiagnostics');

// PUBLIC_INTERFACE
async function getLlmCostsLastDiagnostics(req, res) {
  /** Returns last diagnostics captured by list handler */
  try {
    const last = getDiagnosticsStore().get();
    return res.status(200).json({ success: true, data: last || null });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'diagnostics_unavailable', message: err?.message || 'Unknown error' });
  }
}

module.exports = {
  getLlmCostsLastDiagnostics,
};
