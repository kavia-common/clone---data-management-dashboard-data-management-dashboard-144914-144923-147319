const mongoose = require('mongoose');

/**
 * LLM Costs model
 * This schema is permissive to accommodate varied cost records from different agents/models.
 * Common fields are indexed to support filtering and sorting in list endpoints.
 */
const CostBreakdownSchema = new mongoose.Schema(
  {
    // Arbitrary key-value pairs for cost components (e.g., prompt_tokens, completion_tokens, input_cost, output_cost)
  },
  { _id: false, strict: false }
);

const LLMCostsSchema = new mongoose.Schema(
  {
    task_id: { type: String, index: true },
    session_id: { type: String, index: true }, // if linked with session_tracking
    tenant_id: { type: String, index: true },
    organization_id: { type: String, index: true },
    user_id: { type: mongoose.Schema.Types.Mixed, index: true },
    organization_name: { type: String },
    llm_model: { type: String, index: true },
    provider: { type: String }, // openai, anthropic, etc.
    service_type: { type: String }, // code generation, query, etc.
    operation: { type: String }, // e.g., "chat.completions"
    // Numeric total cost; callers should strip currency symbols before persisting.
    // Server list/aggregation endpoints defensively coerce strings (e.g. "$1.23") to numbers where needed.
    total_cost: { type: Number, index: true },
    currency: { type: String, default: 'USD' },
    breakdown: { type: CostBreakdownSchema, default: () => ({}) },
    metadata: { type: mongoose.Schema.Types.Mixed }, // free-form
    timestamp: { type: Date, index: true, default: Date.now },
    created_at: { type: Date, index: true, default: Date.now },
    updated_at: { type: Date, index: true, default: Date.now },
  },
  {
    timestamps: false,
    collection: 'llm-costs',
    strict: false, // allow additional fields that may exist in real documents
  }
);

/**
 * Indexes:
 * - Single-field: organization_id, tenant_id, timestamp
 * - Compound: { organization_id:1, timestamp:-1 }, { tenant_id:1, timestamp:-1 }, and stable sort variants with _id
 */
LLMCostsSchema.index({ organization_id: 1 });
LLMCostsSchema.index({ tenant_id: 1 });
LLMCostsSchema.index({ timestamp: -1 });

// Useful indexes for common filter/sort combos
LLMCostsSchema.index({ organization_id: 1, timestamp: -1 }); // main path by org with recent-first sort
LLMCostsSchema.index({ organization_id: 1, _id: -1 }); // stable pagination by org
LLMCostsSchema.index({ tenant_id: 1, timestamp: -1 }); // supports default sort and tenant scoping
LLMCostsSchema.index({ tenant_id: 1, created_at: -1 }); // alternative sort path

// Add compound indexes for the common list path and sort stability
LLMCostsSchema.index({ organization_id: 1, timestamp: -1, _id: 1 });
LLMCostsSchema.index({ tenant_id: 1, timestamp: -1, _id: 1 });
LLMCostsSchema.index({ tenant_id: 1, created_at: -1, _id: 1 });

LLMCostsSchema.index({ project_id: 1, timestamp: -1 });
LLMCostsSchema.index({ session_id: 1, timestamp: -1 });
LLMCostsSchema.index({ llm_model: 1, timestamp: -1 });
LLMCostsSchema.index({ timestamp: 1, llm_model: 1 }); // composite index to support usage-over-time aggregation
LLMCostsSchema.index({ task_id: 1 });
// Optimize direct project_id lookups for usage endpoint
LLMCostsSchema.index({ project_id: 1 });

LLMCostsSchema.pre('findOneAndUpdate', function (next) {
  this.set({ updated_at: new Date() });
  next();
});

module.exports = mongoose.model('LLMCost', LLMCostsSchema);
