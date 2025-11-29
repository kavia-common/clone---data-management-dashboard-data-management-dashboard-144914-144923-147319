const mongoose = require('mongoose');

/**
 * LLM Costs model
 * Permissive schema for varied cost records. Includes indexes to optimize listing.
 */
const LLMCostsSchema = new mongoose.Schema(
  {
    organization_id: { type: String, index: true },
    tenant_id: { type: String, index: true },
    users: { type: Array, default: [] },     // expected to contain objects possibly with user_cost
    project: { type: Array, default: [] },   // array for which we compute size as project_count
    total_cost: { type: Number, default: 0 },
    created_at: { type: Date, index: true, default: Date.now },
    timestamp: { type: Date, index: true, default: Date.now },
  },
  {
    timestamps: true,              // adds createdAt, updatedAt
    strict: false,
    minimize: false,
    collection: 'llm-costs',       // normalized collection name
  }
);

// Performance indexes to optimize listing and filtering by tenant + time
LLMCostsSchema.index({ organization_id: 1, createdAt: -1 });
LLMCostsSchema.index({ organization_id: 1, _id: -1 });
LLMCostsSchema.index({ tenant_id: 1, createdAt: -1 });
LLMCostsSchema.index({ tenant_id: 1, _id: -1 });
LLMCostsSchema.index({ organization_id: 1, timestamp: -1 });
LLMCostsSchema.index({ tenant_id: 1, timestamp: -1 });
// Include created_at (snake) as some datasets store this instead of createdAt
LLMCostsSchema.index({ organization_id: 1, created_at: -1 });
LLMCostsSchema.index({ tenant_id: 1, created_at: -1 });

module.exports = mongoose.model('LLMCost', LLMCostsSchema);
