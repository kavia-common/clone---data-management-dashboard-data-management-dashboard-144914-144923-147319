const mongoose = require('mongoose');

/**
 * LLM Costs model mapping to 'llm_cost' collection.
 * Fields accommodate different possible shapes: total_cost or amount, currency, timestamp, and project_id.
 */
const LlmCostSchema = new mongoose.Schema(
  {
    project_id: { type: String, index: true, description: 'Associated project ID' },
    // Support either total_cost or amount fields, and preserve precision via Decimal128 if present.
    total_cost: { type: mongoose.Schema.Types.Decimal128, required: false },
    amount: { type: mongoose.Schema.Types.Decimal128, required: false },
    currency: { type: String, default: 'USD' },
    timestamp: { type: Date, default: Date.now },
    // Allow any additional fields that may exist in the collection
  },
  { collection: 'llm_cost', strict: false, timestamps: false }
);

// Ensure an index on project_id for faster aggregation lookups.
LlmCostSchema.index({ project_id: 1 });

// Avoid recompilation in watch mode
const modelName = 'LlmCost';
module.exports = mongoose.models[modelName] || mongoose.model(modelName, LlmCostSchema);
