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
  },
  {
    collection: 'session_tracking',
    strict: false,
    minimize: false,
  }
);

// Create efficient compound indexes for common filters and sorts.
// These help queries of the form: { tenant_id, ... }.sort(-session_start/last_updated)
SessionTrackingSchema.index({ tenant_id: 1, session_start: -1 });
SessionTrackingSchema.index({ tenant_id: 1, last_updated: -1 });
// For optional status filtering within tenant and sort by recent updates
SessionTrackingSchema.index({ tenant_id: 1, status: 1, last_updated: -1 });
// Keep single field indexes above for flexibility.

const SessionTracking =
  mongoose.models.SessionTracking || mongoose.model('SessionTracking', SessionTrackingSchema);

module.exports = SessionTracking;
