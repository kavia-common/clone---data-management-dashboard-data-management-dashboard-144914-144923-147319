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

    // New session_breakdown nested array to store sub-session segments
    session_breakdown: [
      {
        session_start: { type: Date, index: true },
        session_end: { type: Date, index: true },
        duration: { type: Number, default: 0 }, // seconds (or ms if producer uses ms; UI will compute when missing)
        Agents: { type: [mongoose.Schema.Types.Mixed], default: [] }, // leave flexible
        user_id: { type: mongoose.Schema.Types.Mixed, index: true },
      },
    ],
  },
  {
    collection: 'session_tracking',
    strict: false, // keep flexible existing data
    minimize: false,
  }
);

const SessionTracking =
  mongoose.models.SessionTracking || mongoose.model('SessionTracking', SessionTrackingSchema);

module.exports = SessionTracking;
