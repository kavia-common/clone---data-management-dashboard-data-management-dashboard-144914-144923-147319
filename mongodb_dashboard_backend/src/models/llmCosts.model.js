const mongoose = require('mongoose');

/**
 * PUBLIC_INTERFACE
 * LLMCost Mongoose Model
 *
 * Purpose:
 * - Represents individual LLM usage/cost records used by /api/llm-costs list and related analytics.
 * - The schema is permissive to accommodate varied records from different providers/agents.
 *
 * Collection mapping:
 * - By default, this model maps to the hyphenated collection name 'llm-costs' to match current deployments.
 * - For legacy deployments where the collection is named with underscores ('llm_costs'), you can set:
 *     process.env.LLMCOSTS_COLLECTION_NAME=llm_costs
 *   at runtime to switch the model's collection name without code changes.
 *
 * Tenant scoping:
 * - Tenant isolation is enforced in controllers/middleware; this model only defines the schema and indexes.
 */
const LLM_COLLECTION_NAME =
  // Prefer explicit model env, fall back to alternate alias, then default
  (process.env.LLMCOSTS_COLLECTION_NAME || process.env.LLM_COSTS_COLLECTION_NAME || '').trim() || 'llm-costs';

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
    project_id: { type: String, index: true },
    user_id: { type: mongoose.Schema.Types.Mixed, index: true },
    organization_name: { type: String },
    llm_model: { type: String, index: true },
    provider: { type: String }, // openai, anthropic, etc.
    service_type: { type: String }, // code generation, query, etc.
    operation: { type: String }, // e.g., "chat.completions"
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
    collection: LLM_COLLECTION_NAME,
    strict: false, // allow additional fields that may exist in real documents
  }
);

// Useful indexes for common filter/sort combos
LLMCostsSchema.index({ tenant_id: 1, timestamp: -1 }); // supports default sort and tenant scoping
LLMCostsSchema.index({ tenant_id: 1, created_at: -1 }); // alternative sort path
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