'use strict';

const mongoose = require('mongoose');

/**
 * PUBLIC_INTERFACE
 * SessionTracking Mongoose model
 * Minimal schema for aggregation and counts in users endpoints and counts.
 */
const SessionTrackingSchema = new mongoose.Schema(
  {
    // Tenant and organization scoping
    tenant_id: { type: String, index: true },
    organization_id: { type: String, index: true, sparse: true },
    organizationId: { type: String, index: true, sparse: true },

    // Common identifiers
    user_id: { type: mongoose.Schema.Types.Mixed, index: true },
    project_id: { type: String, index: true, sparse: true },

    // Status and timing
    status: { type: String, index: true },
    session_start: { type: Date, index: true },
    last_updated: { type: Date, index: true },
    timestamp: { type: Date, index: true },

    // Creation timestamp (varies in source; index for summary speed)
    created_at: { type: Date, index: true, sparse: true },
    createdAt: { type: Date, index: true, sparse: true },
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
