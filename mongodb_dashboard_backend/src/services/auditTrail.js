'use strict';

const AuditLog = require('../models/auditLog.model');

/**
// PUBLIC_INTERFACE
 * recordAudit
 * Creates an audit log entry with provided fields, ensuring ISO timestamp and structure.
 * @param {object} entry - fields including action, resource, user_id, before, after, outcome, reason, path, method, ip, user_agent, trace_id
 */
async function recordAudit(entry = {}) {
  try {
    const payload = {
      ts: new Date(),
      action: entry.action || 'OTHER',
      resource: entry.resource || 'unknown',
      user_id: entry.user_id || null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      outcome: entry.outcome || 'SUCCESS',
      reason: entry.reason || null,
      path: entry.path || '',
      method: entry.method || '',
      ip: entry.ip || '',
      user_agent: entry.user_agent || '',
      trace_id: entry.trace_id || null,
    };
    await AuditLog.create(payload);
  } catch (e) {
     
    console.error('[auditTrail] Failed to record audit', e?.message || e);
  }
}

module.exports = { recordAudit };
