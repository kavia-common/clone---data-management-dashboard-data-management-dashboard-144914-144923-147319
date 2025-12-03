"use strict";

const { getDiagnosticsStore } = require("../utils/llmCostsDiagnostics");

/**
 * PUBLIC_INTERFACE
 * @function getLastLlmCostsDiagnostics
 * @description Returns the last captured diagnostics for /api/llm-costs execution. Helpful for verifying filters, sort, projections,
 *              timing breakdowns, and index usage from the previous execution path.
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 * @returns {void} Sends JSON response { success, data } where data is the last diagnostics object or null
 */
async function getLastLlmCostsDiagnostics(req, res) {
  try {
    const store = getDiagnosticsStore();
    const last = store.get();
    return res.status(200).json({
      success: true,
      data: last,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "diagnostics_unavailable",
      message: err?.message || "Unknown error",
    });
  }
}

module.exports = {
  getLastLlmCostsDiagnostics,
};
