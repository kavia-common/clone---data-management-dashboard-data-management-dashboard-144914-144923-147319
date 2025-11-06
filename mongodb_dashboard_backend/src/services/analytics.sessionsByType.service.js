'use strict';

/**
 * PUBLIC_INTERFACE
 * Aggregate sessions by type constrained to tenant.
 */
const db = require('../config/db');
const { withTenantMatch } = require('../utils/tenantFilter');

/**
 * PUBLIC_INTERFACE
 * aggregateSessionsByType
 * Ensures the first pipeline stage enforces { tenant_id: tenantId } before any other filters.
 */
async function aggregateSessionsByType(tenantId, { from, to } = {}) {
  if (!tenantId) {
    // Defensive: caller should always pass tenantId; return empty to avoid cross-tenant leakage
    return [];
  }
  const { session_tracking } = db.getCollections();
  const timeBounds = [];
  if (from) timeBounds.push({ last_updated: { $gte: new Date(from) } });
  if (to) timeBounds.push({ last_updated: { $lte: new Date(to) } });

  const pipeline = [
    ...(timeBounds.length ? [{ $match: { $and: timeBounds } }] : []),
    { $group: { _id: '$service_type', total: { $sum: 1 } } },
    { $project: { service_type: '$_id', total: 1, _id: 0 } },
    { $sort: { total: -1 } }
  ];

  // Inject the tenant $match as the first stage
  const scoped = withTenantMatch(pipeline, tenantId);
  return session_tracking.aggregate(scoped).toArray();
}

module.exports = { aggregateSessionsByType };
