'use strict';

const mongoose = require('mongoose');
const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * ensureLlmCostsIndexesSafe
 * Ensures critical indexes for /api/llm-costs are present. This is a safe, no-throw initializer
 * intended to run at process start or at first route hit. It respects Mongoose autoIndex=false
 * by manually creating required indexes if missing.
 *
 * Indexes covered:
 *  - { tenant_id: 1, timestamp: -1, _id: 1 }
 *  - { organization_id: 1, timestamp: -1, _id: 1 }
 *  - { tenant_id: 1, created_at: -1 }
 *  - { organization_id: 1, created_at: -1 }
 */
async function ensureLlmCostsIndexesSafe() {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) {
    return;
  }
  try {
    await LLMCost.collection.createIndex({ tenant_id: 1, timestamp: -1, _id: 1 }, { background: true, name: 'tenant_ts_id' });
  } catch (_) {}
  try {
    await LLMCost.collection.createIndex({ organization_id: 1, timestamp: -1, _id: 1 }, { background: true, name: 'org_ts_id' });
  } catch (_) {}
  try {
    await LLMCost.collection.createIndex({ tenant_id: 1, created_at: -1 }, { background: true, name: 'tenant_created_at' });
  } catch (_) {}
  try {
    await LLMCost.collection.createIndex({ organization_id: 1, created_at: -1 }, { background: true, name: 'org_created_at' });
  } catch (_) {}
}

module.exports = { ensureLlmCostsIndexesSafe };
