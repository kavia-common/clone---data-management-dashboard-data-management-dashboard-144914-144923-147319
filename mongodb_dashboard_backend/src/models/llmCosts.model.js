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

// Useful indexes for common filter/sort combos
LLMCostsSchema.index({ tenant_id: 1, timestamp: -1 }); // supports default sort and tenant scoping
LLMCostsSchema.index({ tenant_id: 1, created_at: -1 }); // alternative sort path
LLMCostsSchema.index({ organization_id: 1, timestamp: -1 }); // support alias field
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

/**
 * PUBLIC_INTERFACE
 * ensureLLMCostsIndexes
 * Ensures critical indexes are present for performant list and pagination queries:
 * - { tenant_id: 1, timestamp: -1 } for default sort and tenant scoping
 * - { tenant_id: 1, created_at: -1 } as alternative
 * - Single-field indexes are already declared on schema
 * Safe to call at startup or lazily; logs errors but does not throw.
 */
async function ensureLLMCostsIndexes() {
  try {
    // Compile model if not yet compiled
    if (!mongoose.models.LLMCost) {
      mongoose.model('LLMCost', LLMCostsSchema);
    }
  } catch (_) {
    // ignore recompile errors
  }
  const Model = mongoose.models.LLMCost || mongoose.model('LLMCost', LLMCostsSchema);
  try {
    // Create/ensure key compound indexes explicitly (in case autoIndex is disabled)
    await Model.collection.createIndex({ tenant_id: 1, timestamp: -1 }, { background: true });
  } catch (e) {
    console.warn('[LLMCost.ensureIndexes] createIndex tenant_id+timestamp failed:', e?.message || e);
  }
  try {
    await Model.collection.createIndex({ tenant_id: 1, created_at: -1 }, { background: true });
  } catch (e) {
    console.warn('[LLMCost.ensureIndexes] createIndex tenant_id+created_at failed:', e?.message || e);
  }
  try {
    await Model.collection.createIndex({ organization_id: 1, timestamp: -1 }, { background: true });
  } catch (e) {
    console.warn('[LLMCost.ensureIndexes] createIndex organization_id+timestamp failed:', e?.message || e);
  }
}

const LLMCost = mongoose.model('LLMCost', LLMCostsSchema);
LLMCost.ensureLLMCostsIndexes = ensureLLMCostsIndexes;

// Ensure critical indexes in background at module load (non-blocking)
try {
  ensureLLMCostsIndexes().catch((e) => {
    // log only; do not throw at import time
    console.warn('[LLMCost.model] ensureLLMCostsIndexes at import failed:', e?.message || e);
  });
} catch (_) {}

// PUBLIC_INTERFACE
/**
 * LLMCost model export with ensured background index creation.
 */
/**
 * PUBLIC_INTERFACE
 * LLMCost model export with ensured background index creation.
 */
module.exports = LLMCost;
