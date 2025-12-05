/**
 * PUBLIC_INTERFACE
 * Minimal Mongoose model for llm costs. Collection name is configurable via env LLMCOSTS_COLLECTION_NAME,
 * defaulting to 'llm-costs'. The schema is loose to support diverse payloads.
 */
const mongoose = require('mongoose');

const LlmCostSchema = new mongoose.Schema(
  {
    request_id: String,
    session_id: String,
    project_id: String,
    timestamp: Date,
    created_at: Date,
    model: String,
    model_version: String,
    provider: String,
    provider_status: String,
    user_id: String,
    organization_id: String,
    tenant_id: String,
    tokens_in: Number,
    tokens_out: Number,
    prompt: String,
    completion: String,
    cost_usd: Number,
    total_cost: Number,
    currency: String,
    duration_ms: Number,
    status: String,
    details: mongoose.Schema.Types.Mixed,
  },
  { strict: false, timestamps: false }
);

// Use configured collection name
const collectionName = process.env.LLMCOSTS_COLLECTION_NAME || 'llm-costs';

module.exports = mongoose.models.LlmCost || mongoose.model('LlmCost', LlmCostSchema, collectionName);
