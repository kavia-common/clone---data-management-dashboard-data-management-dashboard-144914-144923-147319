const mongoose = require('mongoose');

/**
 * AuditLog model for GxP-compliant audit trail.
 * Captures user actions with metadata and optional before/after payload snapshots.
 */
const AuditLogSchema = new mongoose.Schema(
  {
    ts: { type: Date, default: Date.now, index: true },
    user_id: { type: mongoose.Schema.Types.Mixed, index: true },
    action: {
      type: String,
      enum: ['CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'OTHER'],
      required: true,
      index: true,
    },
    resource: { type: String, default: '', index: true }, // e.g., 'session.tenant'
    path: { type: String, default: '' },
    method: { type: String, default: '' },
    ip: { type: String, default: '' },
    user_agent: { type: String, default: '' },
    reason: { type: String, default: null },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    outcome: { type: String, enum: ['SUCCESS', 'FAILURE'], default: 'SUCCESS' },
    trace_id: { type: String, default: null },
  },
  { timestamps: false, collection: 'audit_logs', strict: false }
);

AuditLogSchema.index({ action: 1, resource: 1, ts: -1 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
