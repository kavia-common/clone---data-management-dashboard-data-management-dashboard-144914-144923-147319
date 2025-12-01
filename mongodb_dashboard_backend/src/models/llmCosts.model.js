const mongoose = require('mongoose');

/**
 * LLM Costs model
 * Permissive schema for varied cost records. Includes indexes to optimize listing.
 */
const LLMCostsSchema = new mongoose.Schema(
  {
    organization_id: { type: String, index: true },
    tenant_id: { type: String, index: true },
    organization_name: { type: String, index: false },
    organization_cost: { type: mongoose.Schema.Types.Mixed, index: false }, // can be string or number in datasets
    users: { type: Array, default: [] },
    project: { type: Array, default: [] },
    projects: { type: Array, default: [] },
    agents: { type: Array, default: [] },
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

// Ensure arrays are arrays when loading docs (defensive)
LLMCostsSchema.post('init', function ensureArrays() {
  if (!Array.isArray(this.users)) this.users = [];
  if (!Array.isArray(this.projects)) this.projects = Array.isArray(this.project) ? this.project : [];
  if (!Array.isArray(this.agents)) this.agents = [];
});

/* Performance indexes to optimize listing and filtering by tenant + time
 * Coverage for the GET /api/llm-costs fast path:
 *  - Exact match on organization_id (when provided)
 *  - Sort by _id desc (native ObjectId monotonic order)
 *  These indexes ensure a bounded, non-scanning query path.
 */
LLMCostsSchema.index({ organization_id: 1, _id: -1 }); // Critical index to serve GET /api/llm-costs with tenant filter and sort by _id desc
LLMCostsSchema.index({ tenant_id: 1, _id: -1 });       // Alternate tenant field index

// Time-based variants to allow future sorts while preserving index scan order for pagination
LLMCostsSchema.index({ organization_id: 1, createdAt: -1, _id: -1 });
LLMCostsSchema.index({ tenant_id: 1, createdAt: -1, _id: -1 });
LLMCostsSchema.index({ organization_id: 1, timestamp: -1, _id: -1 });
LLMCostsSchema.index({ tenant_id: 1, timestamp: -1, _id: -1 });
// Include created_at (snake) as some datasets store this instead of createdAt
LLMCostsSchema.index({ organization_id: 1, created_at: -1, _id: -1 });
LLMCostsSchema.index({ tenant_id: 1, created_at: -1, _id: -1 });

// Legacy field name compatibility (sparse to avoid bloat)
LLMCostsSchema.index({ organizationId: 1, createdAt: -1, _id: -1 }, { sparse: true });
LLMCostsSchema.index({ tenantId: 1, createdAt: -1, _id: -1 }, { sparse: true });

/** Join note:
 * users[].user_id is expected to be a string UUID that matches users._id (string).
 * Enrichment in the controller performs a single batched fetch by users._id using $in.
 */

/**
 * Helpful partial index on users.user_id for faster $unwind lookups if present.
 * Note: This may be a large index; if not desired in production, gate with env MONGOOSE_AUTO_INDEX.
 */
try {
  LLMCostsSchema.index({ 'users.user_id': 1 }, { sparse: true });
} catch (_) {}

module.exports = mongoose.model('LLMCost', LLMCostsSchema, 'llm-costs');
