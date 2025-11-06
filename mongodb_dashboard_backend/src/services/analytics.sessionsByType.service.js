'use strict';

/**
 * PUBLIC_INTERFACE
 * Aggregate sessions by type constrained to tenant.
 */
const db = require('../config/db');
const { withTenantMatch } = require('../utils/tenantFilter');

async function aggregateSessionsByType(tenantId, { from, to } = {}) {
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

  return session_tracking.aggregate(withTenantMatch(pipeline, tenantId)).toArray();
}

module.exports = { aggregateSessionsByType };
