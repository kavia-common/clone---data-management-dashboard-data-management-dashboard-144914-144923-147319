'use strict';

/**
 * PUBLIC_INTERFACE
 * SessionsAggregatesService: Efficient aggregation helpers for session_tracking.
 * - by organization (tenant-aware, group by organization_name with fallback to tenant_id)
 * - by type (group by service_type/session_type/type)
 * Works with Mongoose connections by using mongoose.connection.db.listCollections/collection.
 * Gracefully handles disconnected DB by returning empty arrays to callers.
 *
 * Notes on indexes:
 *  Ensure the following indexes exist on session_tracking collection:
 *   - { tenant_id: 1, last_updated: -1 }
 *   - { tenant_id: 1, session_start: -1 }
 *   - { service_type: 1 }
 *   - { session_type: 1 }
 *   - { type: 1 }
 *   - { organization_name: 1 } (optional, improves by-organization)
 *
 *   The service applies a time window ($match on last_updated OR session_start).
 */

const mongoose = require('mongoose');

// Simple in-memory cache with TTL
const _cache = new Map();
const DEFAULT_TTL_MS = 45 * 1000; // 45 seconds

function _cacheKey(name, params) {
  return `${name}:${JSON.stringify(params || {})}`;
}

function _getCache(key) {
  const ent = _cache.get(key);
  if (!ent) return null;
  if (Date.now() > ent.expiresAt) {
    _cache.delete(key);
    return null;
  }
  return ent.value;
}

function _setCache(key, value, ttlMs = DEFAULT_TTL_MS) {
  _cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function _parseDateSafe(v) {
  if (!v) return null;
  try {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function _tenantMatch(tenantId) {
  if (!tenantId) return null;
  return {
    $or: [
      { tenant_id: tenantId },
      { organization_id: tenantId },
      { organizationId: tenantId },
    ],
  };
}

/**
 * Build a time filter using last_updated (preferred) and fallback to session_start.
 * If both start and end are provided, bounds are inclusive.
 */
function _buildTimeMatch({ start, end }) {
  const s = _parseDateSafe(start);
  const e = _parseDateSafe(end);
  if (!s && !e) return null;

  const makeBounds = (field) => {
    const cond = {};
    if (s) cond.$gte = s;
    if (e) cond.$lte = e;
    return { [field]: cond };
  };

  // Prefer last_updated; keep a fallback OR on session_start for older docs
  const clauses = [];
  clauses.push(makeBounds('last_updated'));
  clauses.push(makeBounds('session_start'));
  return { $or: clauses };
}

/**
 * Resolve the native collection handle using the active Mongoose connection.
 * If DB is disconnected or unavailable, returns null.
 */
function _getSessionTrackingCollection() {
  const ready = mongoose.connection?.readyState;
  if (ready !== 1 || !mongoose.connection?.db) {
    return null;
  }
  // Prefer an existing collection name, default to 'session_tracking'
  try {
    return mongoose.connection.db.collection('session_tracking');
  } catch {
    return null;
  }
}

// PUBLIC_INTERFACE
async function sessionsByType({ tenantId, start, end, limit = 20, allowBypass = false }) {
  /**
   * Returns [{ type, total }]
   * Groups by one of ["service_type", "session_type", "type"] in that order of preference.
   */
  const cacheKey = _cacheKey('sessionsByType', { tenantId, start, end, limit, allowBypass });
  const cached = _getCache(cacheKey);
  if (cached) return cached;

  const col = _getSessionTrackingCollection();
  if (!col) {
    const empty = [];
    _setCache(cacheKey, empty);
    return empty;
  }

  const matchStages = [];

  const tMatch = !allowBypass ? _tenantMatch(tenantId) : null;
  if (tMatch) matchStages.push(tMatch);

  const timeMatch = _buildTimeMatch({ start, end });
  if (timeMatch) matchStages.push(timeMatch);

  // Project a normalized type field for grouping
  const pipeline = [
    ...(matchStages.length ? [{ $match: { $and: matchStages } }] : []),
    {
      $addFields: {
        _norm_type: {
          $ifNull: [
            { $ifNull: ['$service_type', { $ifNull: ['$session_type', '$type'] }] },
            'Unknown',
          ],
        },
      },
    },
    {
      $group: {
        _id: '$_norm_type',
        total: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        type: '$_id',
        total: 1,
      },
    },
    { $sort: { total: -1 } },
    ...(limit ? [{ $limit: Math.max(1, Number(limit) || 20) }] : []),
  ];

  const result = await col.aggregate(pipeline, { allowDiskUse: true }).toArray();
  _setCache(cacheKey, result);
  return result;
}

// PUBLIC_INTERFACE
async function sessionsByOrganization({ tenantId, start, end, limit = 20, allowBypass = false }) {
  /**
   * Returns [{ organization, total }]
   * Groups by organization_name with fallback to tenant_id when absent.
   */
  const cacheKey = _cacheKey('sessionsByOrg', { tenantId, start, end, limit, allowBypass });
  const cached = _getCache(cacheKey);
  if (cached) return cached;

  const col = _getSessionTrackingCollection();
  if (!col) {
    const empty = [];
    _setCache(cacheKey, empty);
    return empty;
  }

  const matchStages = [];

  const tMatch = !allowBypass ? _tenantMatch(tenantId) : null;
  if (tMatch) matchStages.push(tMatch);

  const timeMatch = _buildTimeMatch({ start, end });
  if (timeMatch) matchStages.push(timeMatch);

  const pipeline = [
    ...(matchStages.length ? [{ $match: { $and: matchStages } }] : []),
    {
      $addFields: {
        _org: {
          $cond: [
            { $gt: [{ $strLenCP: { $ifNull: ['$organization_name', ''] } }, 0] },
            '$organization_name',
            { $ifNull: ['$tenant_id', 'Unknown'] },
          ],
        },
      },
    },
    {
      $group: {
        _id: '$_org',
        total: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        organization: '$_id',
        total: 1,
      },
    },
    { $sort: { total: -1 } },
    ...(limit ? [{ $limit: Math.max(1, Number(limit) || 20) }] : []),
  ];

  const result = await col.aggregate(pipeline, { allowDiskUse: true }).toArray();
  _setCache(cacheKey, result);
  return result;
}

module.exports = {
  sessionsByType,
  sessionsByOrganization,
  // internal for testing
  _buildTimeMatch,
  _tenantMatch,
};
