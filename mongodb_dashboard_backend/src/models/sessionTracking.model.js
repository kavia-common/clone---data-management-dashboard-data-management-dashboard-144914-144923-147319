'use strict';

const mongoose = require('mongoose');

/**
 * PUBLIC_INTERFACE
 * SessionTracking Mongoose model
 * Minimal schema for aggregation and counts in users endpoints and counts.
 */
const SessionTrackingSchema = new mongoose.Schema(
  {
    tenant_id: { type: String, index: true },
    user_id: { type: mongoose.Schema.Types.Mixed, index: true },
    status: { type: String, index: true },
    session_start: { type: Date, index: true },
    last_updated: { type: Date, index: true },
    timestamp: { type: Date, index: true },
    project_id: { type: String, index: true, sparse: true },

    // NOTE: session_tracking documents may also include aggregate fields used by the UI.
    // We keep strict:false so MongoDB documents can carry these without schema migrations.
    // Examples:
    // - total_count: number of sessions for a user
    // - total_duration: total duration across sessions (units depend on ingest; often seconds)
    total_count: { type: Number },
    total_duration: { type: mongoose.Schema.Types.Mixed },
  },
  {
    collection: 'session_tracking',
    strict: false,
    minimize: false,
  }
);

const SessionTracking =
  mongoose.models.SessionTracking || mongoose.model('SessionTracking', SessionTrackingSchema);

module.exports = SessionTracking;
