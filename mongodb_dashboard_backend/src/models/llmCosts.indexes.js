'use strict';

const LlmCost = require('./llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * ensureLlmCostsIndexes
 * Ensures critical indexes exist on the llm-costs collection. Safe to call at runtime;
 * will no-op when indexes already exist. Designed for environments with MONGOOSE_AUTO_INDEX=FALSE.
 * Returns a summary of ensured indexes or throws on fatal error (rare).
 */
async function ensureLlmCostsIndexes() {
  // Indexes defined at schema level are:
  // - { tenant_id: 1, timestamp: -1 }
  // - { organization_id: 1, timestamp: -1 }
  // - Additional helpful indexes declared in schema.
  // Here, we call model.syncIndexes() to reconcile desired indexes with the collection.
  // Note: syncIndexes will create missing ones and drop extraneous indexes created by Mongoose only
  // if they are not present in the schema. We do not drop any user-created indexes (Mongo preserves those).
  const res = await LlmCost.syncIndexes();
  return res;
}

module.exports = {
  ensureLlmCostsIndexes,
};
