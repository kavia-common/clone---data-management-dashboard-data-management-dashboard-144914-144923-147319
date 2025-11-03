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
    // Store a lowercase version for fast case-insensitive exact matching
    user_name_lower: { type: String, default: null, index: true },
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
    created_at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false, collection: 'session_tracking' }
);

// Keep user_name_lower in sync when setting user_name
SessionTrackingSchema.pre('save', function updateLowerName(next) {
  if (typeof this.user_name === 'string' && this.user_name.trim() !== '') {
    this.user_name_lower = this.user_name.toLowerCase();
  } else if (typeof this.User_name === 'string' && this.User_name.trim() !== '') {
    this.user_name_lower = this.User_name.toLowerCase();
  }
  next();
});

// Suggested compound indexes for common access patterns
SessionTrackingSchema.index({ tenant_id: 1, status: 1, session_start: -1 });
SessionTrackingSchema.index({ user_id: 1, session_start: -1 });
SessionTrackingSchema.index({ project_id: 1, service_type: 1 });
SessionTrackingSchema.index({ task_id: 1 });
SessionTrackingSchema.index({ last_updated: -1 });
SessionTrackingSchema.index({ created_at: -1 });
// Support user projects aggregation by tenant_id + user_id with recency
SessionTrackingSchema.index({ tenant_id: 1, user_id: 1, last_updated: -1 });
 // For active users trend queries filtering by status and time
SessionTrackingSchema.index({ tenant_id: 1, status: 1, last_updated: -1, session_start: -1 });
// Recommended compound when tenant and time are used together
SessionTrackingSchema.index({ tenant_id: 1, created_at: -1 });
// Additional index to support features-usage early $match and grouping
SessionTrackingSchema.index({ created_at: -1, tenant_id: 1, user_id: 1, service_type: 1 });
SessionTrackingSchema.index({ last_updated: -1, tenant_id: 1, user_id: 1, service_type: 1 });

// Ensure fast user lookups with case-insensitive exact name
SessionTrackingSchema.index({ user_name_lower: 1, tenant_id: 1 });

// Ensure fast project-level aggregations; if already declared above, Mongoose de-duplicates identical specs.
SessionTrackingSchema.index({ project_id: 1 });

// Ensure index creation on startup (can be overridden by env MONGOOSE_AUTO_INDEX)
SessionTrackingSchema.set('autoIndex', true);

module.exports = mongoose.model('SessionTracking', SessionTrackingSchema);
