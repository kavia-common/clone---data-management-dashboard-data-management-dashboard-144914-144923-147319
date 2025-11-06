'use strict';

/**
 * PUBLIC_INTERFACE
 * getUsersTenantSummary
 * Returns minimal tenant summary for users. Designed to be DB-agnostic for preview.
 */
async function getUsersTenantSummary(req, res) {
  // In a real implementation, aggregate from session_tracking or users/tenants collections.
  // For preview, return an empty list or a minimal demo row if a tenant header is provided.
  const tid = req.headers['x-tenant-id'] || req.headers['x-tenant'] || (req.auth && req.auth.tenantId);
  const items = tid ? [{ tenant_id: String(tid), tenant_name: String(tid), user_count: 0 }] : [];
  return res.status(200).json({ items, total: items.length });
}

module.exports = { getUsersTenantSummary };
