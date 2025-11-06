'use strict';

const mongoose = require('mongoose');
const { Schema, model } = mongoose;

/**
 * PUBLIC_INTERFACE
 * Minimal SessionTracking model
 * - Matches fields used by routes and dev seed.
 * - Collection: 'session_tracking'
 */
const sessionTrackingSchema = new Schema(
  {
    task_id: { type: String },
    tenant_id: { type: String, index: true },
    organization_name: { type: String },
    user_id: { type: String },
    user_name: { type: String },
    project_id: { type: String },
    container_id: { type: String },
    service_type: { type: String },
    session_start: { type: Date },
    session_end: { type: Date, default: null },
    status: { type: String, default: 'active' },
    total_cost: { type: Number, default: 0 },
    agent_costs: Schema.Types.Mixed,
    cost_history: [Schema.Types.Mixed],
    last_updated: { type: Date, default: Date.now },
    session_data: Schema.Types.Mixed,
    created_at: { type: Date, default: Date.now },
  },
  { collection: 'session_tracking' }
);

module.exports = model('SessionTracking', sessionTrackingSchema);
