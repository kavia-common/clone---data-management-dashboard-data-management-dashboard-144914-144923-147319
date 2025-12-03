const mongoose = require('mongoose');

/**
 * LLM Costs model
 * Schema is flexible to accommodate varied cost records from different agents/models.
 * PUBLIC_INTERFACE: Mongoose model 'LLMCost'
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
    total_cost: { type: Number, index: true }, // numeric cost
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
 * - Compound: { organization_id:1, timestamp:-1 } main path; plus tenant-based variants for compatibility
 */
LLMCostsSchema.index({ organization_id: 1 });
LLMCostsSchema.index({ tenant_id: 1 });
LLMCostsSchema.index({ timestamp: -1 });

// Primary index: organization_id + timestamp desc
LLMCostsSchema.index({ organization_id: 1, timestamp: -1 }, { name: 'org_time_desc' });

// Tenant-based support indexes for compatibility
LLMCostsSchema.index({ tenant_id: 1, timestamp: -1 }, { name: 'tenant_time_desc' });
LLMCostsSchema.index({ tenant_id: 1, created_at: -1 }, { name: 'tenant_created_desc' });

// Sort stability variants
LLMCostsSchema.index({ organization_id: 1, timestamp: -1, _id: 1 }, { name: 'org_time_id' });
LLMCostsSchema.index({ tenant_id: 1, timestamp: -1, _id: 1 }, { name: 'tenant_time_id' });

// Additional helpful indexes
LLMCostsSchema.index({ project_id: 1, timestamp: -1 });
LLMCostsSchema.index({ session_id: 1, timestamp: -1 });
LLMCostsSchema.index({ llm_model: 1, timestamp: -1 });
LLMCostsSchema.index({ timestamp: 1, llm_model: 1 });
LLMCostsSchema.index({ task_id: 1 });

LLMCostsSchema.pre('findOneAndUpdate', function (next) {
  this.set({ updated_at: new Date() });
  next();
});

// PUBLIC_INTERFACE
module.exports = mongoose.model('LLMCost', LLMCostsSchema);
