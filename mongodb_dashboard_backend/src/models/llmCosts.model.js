'use strict';

const mongoose = require('mongoose');
const { Schema, model } = mongoose;

/**
 * PUBLIC_INTERFACE
 * Minimal LLMCost model
 * - Used for CRUD and seed endpoints.
 * - Collection: 'llm_costs'
 */
const llmCostsSchema = new Schema(
  {
    tenant_id: { type: String, index: true },
    llm_model: { type: String },
    provider: { type: String },
    service_type: { type: String },
    operation: { type: String },
    total_cost: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
    breakdown: Schema.Types.Mixed,
    // Some analytics pipeline expects embedded Agents array; allow Mixed
    Agents: [Schema.Types.Mixed],
    timestamp: { type: Date, default: Date.now },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  { collection: 'llm_costs' }
);

module.exports = model('LLMCost', llmCostsSchema);
