const mongoose = require('mongoose');

const CostHistorySchema = new mongoose.Schema(
  {
    timestamp: { type: Date, required: true },
    agent_costs: { type: mongoose.Schema.Types.Mixed },
    total_cost: { type: Number, required: true },
  },
  { _id: false }
);

const SelectedReposSchema = new mongoose.Schema(
  {
    all_repositories: { type: Boolean, default: false },
    repositories: [{ type: String }],
  },
  { _id: false }
);

const SessionDataSchema = new mongoose.Schema(
  {
    llm_model: { type: String },
    session_name: { type: String },
    description: { type: String },
    platform: { type: String },
    selected_repos: { type: SelectedReposSchema },
  },
  { _id: false }
);

const SessionTrackingSchema = new mongoose.Schema(
  {
    task_id: { type: String },
    tenant_id: { type: String, index: true },
    organization_name: { type: String },
    user_id: { type: mongoose.Schema.Types.Mixed, index: true }, // could be string or ObjectId
    user_name: { type: String, alias: 'User_name' },
    project_id: { type: String, index: true },
    container_id: { type: String },
    service_type: {
      type: String,
      enum: [
        'code generation',
        'code query',
        'deep query',
        'interactive configuration',
        'auto configuration',
        'code maintenance',
      ],
    },
    session_start: { type: Date, index: true },
    session_end: { type: Date, default: null },
    status: { type: String, enum: ['active', 'completed', 'failed'], index: true },
    total_cost: { type: Number },
    agent_costs: { type: mongoose.Schema.Types.Mixed },
    cost_history: [CostHistorySchema],
    last_updated: { type: Date, index: true },
    session_data: { type: SessionDataSchema },
    created_at: { type: Date, default: Date.now },
  },
  { timestamps: false, collection: 'session_tracking' }
);

// Suggested compound indexes
SessionTrackingSchema.index({ tenant_id: 1, status: 1, session_start: -1 });
SessionTrackingSchema.index({ user_id: 1, session_start: -1 });
SessionTrackingSchema.index({ project_id: 1, service_type: 1 });
SessionTrackingSchema.index({ task_id: 1 });
SessionTrackingSchema.index({ last_updated: -1 });
// Added index to support user projects aggregation by tenant_id + user_id with recency
SessionTrackingSchema.index({ tenant_id: 1, user_id: 1, last_updated: -1 });
// For active users trend queries filtering by status and time, ensure a compound index exists
SessionTrackingSchema.index({ tenant_id: 1, status: 1, last_updated: -1, session_start: -1 });

// Ensure fast project-level aggregations; if already declared above, Mongoose de-duplicates identical specs.
SessionTrackingSchema.index({ project_id: 1 });

module.exports = mongoose.model('SessionTracking', SessionTrackingSchema);
