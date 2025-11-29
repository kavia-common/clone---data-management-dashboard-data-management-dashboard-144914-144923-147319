'use strict';

const { listPerUserLLMCosts } = require('./llmCosts.users.controller');

/**
// PUBLIC_INTERFACE
 * listPerUserFromMainPath
 * A thin wrapper to serve per-user listing under GET /api/llm-costs when pagination params are present.
 *
 * This enables requests like:
 *   GET /api/llm-costs?organization_id=b2c&page=1&limit=10
 * to return the fast per-user tabular data instead of the full document list that can timeout.
 *
 * It delegates to listPerUserLLMCosts to build the safe aggregation.
 */
async function listPerUserFromMainPath(req, res, next) {
  // Delegate directly; controller already handles pagination, tenant scoping, and sorting.
  return listPerUserLLMCosts(req, res, next);
}

module.exports = {
  listPerUserFromMainPath,
};
