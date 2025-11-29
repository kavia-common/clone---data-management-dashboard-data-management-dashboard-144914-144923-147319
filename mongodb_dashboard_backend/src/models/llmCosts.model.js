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
// Core indexes: organization_id + _id desc (native uses _id), and createdAt variants for time sort
LLMCostsSchema.index({ organization_id: 1, _id: -1 });
LLMCostsSchema.index({ tenant_id: 1, _id: -1 });
LLMCostsSchema.index({ organization_id: 1, createdAt: -1, _id: -1 });
LLMCostsSchema.index({ tenant_id: 1, createdAt: -1, _id: -1 });
LLMCostsSchema.index({ organization_id: 1, timestamp: -1, _id: -1 });
LLMCostsSchema.index({ tenant_id: 1, timestamp: -1, _id: -1 });
// Include created_at (snake) as some datasets store this instead of createdAt
LLMCostsSchema.index({ organization_id: 1, created_at: -1, _id: -1 });
LLMCostsSchema.index({ tenant_id: 1, created_at: -1, _id: -1 });

// Optional: index for variant field names used in some datasets
LLMCostsSchema.index({ organizationId: 1, createdAt: -1, _id: -1 }, { sparse: true });
LLMCostsSchema.index({ tenantId: 1, createdAt: -1, _id: -1 }, { sparse: true });

/**
 * Helpful partial index on users.user_id for faster $unwind lookups if present.
 * Note: This may be a large index; if not desired in production, gate with env MONGOOSE_AUTO_INDEX.
 */
try {
  LLMCostsSchema.index({ 'users.user_id': 1 }, { sparse: true });
} catch (_) {}

module.exports = mongoose.model('LLMCost', LLMCostsSchema);
