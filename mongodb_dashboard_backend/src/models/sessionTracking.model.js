'use strict';

const mongoose = require('mongoose');

/**
 * PUBLIC_INTERFACE
 * SessionTracking Mongoose model
 * Minimal schema for aggregation and counts in users endpoints and counts.
 * We keep strict:false to allow flexible fields while providing indexes for common queries.
 *
 * Expected optional fields (documented for clarity; not strictly enforced):
 * - _id
 * - task_id
 * - tenant_id
 * - organization_name
 * - user_id
 * - user_name / User_name
 * - project_id
 * - container_id
 * - service_type
 * - session_start
 * - session_end
 * - status
 * - total_cost
 * - agent_costs (object<string, number|string|Decimal128>)
 * - cost_history (array of { total_cost, agent_costs, ts })
 * - last_updated
 * - session_data (object, may contain created_at, session_name, description, llm_model)
 * - session_breakdown (array of { session_start, session_end, duration, Agent?: string[] , user_id })
 */
const SessionTrackingSchema = new mongoose.Schema(
  {
    tenant_id: { type: String, index: true },
    user_id: { type: mongoose.Schema.Types.Mixed, index: true },
    status: { type: String, index: true },
    session_start: { type: Date, index: true },
    session_end: { type: Date, index: true, sparse: true },
    last_updated: { type: Date, index: true },
    timestamp: { type: Date, index: true },
    project_id: { type: String, index: true, sparse: true },
    container_id: { type: String, index: true, sparse: true },
    service_type: { type: String, index: true, sparse: true },
    organization_name: { type: String, index: true, sparse: true },
    // Flexible cost fields; not strictly typed because of heterogeneous sources
    total_cost: { type: mongoose.Schema.Types.Mixed },
    agent_costs: { type: mongoose.Schema.Types.Mixed, default: undefined },
    cost_history: { type: [mongoose.Schema.Types.Mixed], default: undefined },
    // Session metadata and breakdown (arrays/objects; flexible)
    session_data: { type: mongoose.Schema.Types.Mixed, default: undefined },
    session_breakdown: { type: [mongoose.Schema.Types.Mixed], default: undefined },
  },
  {
    collection: 'session_tracking',
    strict: false,
    minimize: false,
  }
);

// Helpful compound indexes for common list/detail queries
try {
  SessionTrackingSchema.index({ tenant_id: 1, session_start: -1 });
  SessionTrackingSchema.index({ tenant_id: 1, last_updated: -1 });
  SessionTrackingSchema.index({ tenant_id: 1, status: 1, session_start: -1 }, { sparse: true });
  SessionTrackingSchema.index({ tenant_id: 1, user_id: 1, session_start: -1 }, { sparse: true });
  SessionTrackingSchema.index({ tenant_id: 1, project_id: 1, session_start: -1 }, { sparse: true });
} catch (_) {
  // Non-fatal if Mongoose version differs
}

const SessionTracking =
  mongoose.models.SessionTracking || mongoose.model('SessionTracking', SessionTrackingSchema);

module.exports = SessionTracking;
