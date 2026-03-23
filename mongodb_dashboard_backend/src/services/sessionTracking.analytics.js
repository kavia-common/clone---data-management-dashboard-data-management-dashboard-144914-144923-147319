'use strict';

const SessionTracking = require('../models/sessionTracking.model');

/**
 * Normalize a string-ish value to a safe non-empty label.
 * @param {any} v
 * @param {string} fallback
 * @returns {string}
 */
function normalizeLabel(v, fallback = 'Unknown') {
  const s = String(v ?? '').trim();
  return s ? s : fallback;
}

/**
 * Build the same q-search filter logic used by /api/session-tracking (list route),
 * but without pagination concerns.
 *
 * Contract:
 * - Input: q string (optional)
 * - Output: MongoDB filter fragment (possibly empty object)
 */
function buildTextSearchFilter(q) {
  const qTrimmed = typeof q === 'string' ? q.trim() : '';
  if (!qTrimmed) return {};

  // Escape user input so q behaves like a literal search string (not an arbitrary regex).
  const escapeRegexLiteral = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapeRegexLiteral(qTrimmed), 'i');

  const looksLikeId = !/\s/.test(qTrimmed);

  const orParts = [
    { task_id: regex },
    { tenant_id: regex },
    { organization_name: regex },
    { user_name: regex },
    { User_name: regex },
    { project_id: regex },
    { container_id: regex },
    { service_type: regex },
    { status: regex },
    { user_id: regex },
    { 'session_data.session_name': regex },
    { 'session_data.description': regex },
    { 'session_data.llm_model': regex },
  ];

  if (looksLikeId) {
    // Preserve the exact-ID shortcut, but still allow general regex matches above.
    orParts.unshift({ user_id: qTrimmed });
  } else {
    const tokens = qTrimmed.split(/\s+/).map((t) => t.trim()).filter(Boolean);
    if (tokens.length >= 2) {
      // Multi-token: require all tokens to appear somewhere in user_name/User_name.
      const tokenRegexes = tokens.map((t) => new RegExp(escapeRegexLiteral(t), 'i'));
      const userNameAllTokens = { $and: tokenRegexes.map((r) => ({ user_name: r })) };
      const userNameAllTokensAlt = { $and: tokenRegexes.map((r) => ({ User_name: r })) };
      orParts.unshift({ $or: [userNameAllTokens, userNameAllTokensAlt] });
    }
  }

  return { $or: orParts };
}

/**
 * Build tenant scope filter consistent with /api/session-tracking.
 *
 * Contract:
 * - Input: { bypass:boolean, tenantId?:string|null }
 * - Output: MongoDB filter fragment (possibly empty)
 */
function buildTenantScopeFilter({ bypass, tenantId }) {
  if (bypass) return {};
  if (!tenantId) return {};
  return {
    $or: [
      { tenant_id: tenantId },
      { organization_id: tenantId },
      { organizationId: tenantId },
    ],
  };
}

/**
 * Build the final MongoDB filter used by the new analytics endpoints.
 *
 * Contract:
 * - Input: { tenantId?:string|null, bypass:boolean, q?:string }
 * - Output: MongoDB filter object
 */
function buildSessionTrackingAnalyticsFilter({ tenantId, bypass, q }) {
  const parts = [];
  const qFilter = buildTextSearchFilter(q);
  const scopeFilter = buildTenantScopeFilter({ bypass, tenantId });

  const isEmpty = (o) => !o || (typeof o === 'object' && Object.keys(o).length === 0);
  if (!isEmpty(qFilter)) parts.push(qFilter);
  if (!isEmpty(scopeFilter)) parts.push(scopeFilter);

  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0];
  return { $and: parts };
}

/**
 * PUBLIC_INTERFACE
 * computeSessionsByOrganizationFlow
 *
 * Flow name: SessionTrackingAnalyticsFlow
 * Single entrypoint for “Sessions by Organization” aggregation.
 *
 * Inputs:
 * - tenantId: string|null  (required unless bypass=true)
 * - bypass: boolean        (true => all-tenants mode)
 * - q?: string             (optional text search, same semantics as /api/session-tracking?q=)
 *
 * Outputs:
 * - Array<{ organization_name: string, session_count: number }>
 *
 * Errors:
 * - Throws Error on DB/aggregation failures (caller maps to HTTP 400/500).
 *
 * Invariants:
 * - Returned array sorted by session_count desc.
 * - organization_name is always a non-empty string (falls back to "Unknown").
 */
async function computeSessionsByOrganizationFlow({ tenantId, bypass, q }) {
  const filter = buildSessionTrackingAnalyticsFilter({ tenantId, bypass, q });

  const pipeline = [
    { $match: filter },
    {
      $addFields: {
        _org: {
          $ifNull: [
            '$organization_name',
            {
              $ifNull: [
                '$organization?.name',
                {
                  $ifNull: [
                    '$tenant_id',
                    { $ifNull: ['$organization_id', { $ifNull: ['$organizationId', 'Unknown'] }] },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
    { $group: { _id: '$_org', session_count: { $sum: 1 } } },
    { $project: { _id: 0, organization_name: '$_id', session_count: 1 } },
    { $sort: { session_count: -1 } },
    { $limit: 200 },
  ];

  const rows = await SessionTracking.aggregate(pipeline).allowDiskUse(true);
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    organization_name: normalizeLabel(r?.organization_name, 'Unknown'),
    session_count: Number(r?.session_count || 0),
  }));
}

/**
 * PUBLIC_INTERFACE
 * computeSessionsByTypeFlow
 *
 * Flow name: SessionTrackingAnalyticsFlow
 * Single entrypoint for “Sessions by Type” aggregation (frontend treats this as “service type”).
 *
 * Inputs/outputs same shape the frontend expects today:
 * - Array<{ session_type: string, session_count: number }>
 *
 * Notes:
 * - Mirrors Sessions.jsx client aggregation:
 *   session_type := session.session_type || session.type || session.service_type
 */
async function computeSessionsByTypeFlow({ tenantId, bypass, q }) {
  const filter = buildSessionTrackingAnalyticsFilter({ tenantId, bypass, q });

  const pipeline = [
    { $match: filter },
    {
      $addFields: {
        _type: {
          $ifNull: [
            '$session_type',
            { $ifNull: ['$type', { $ifNull: ['$service_type', 'Unknown'] }] },
          ],
        },
      },
    },
    { $group: { _id: '$_type', session_count: { $sum: 1 } } },
    { $project: { _id: 0, session_type: '$_id', session_count: 1 } },
    { $sort: { session_count: -1 } },
    { $limit: 500 },
  ];

  const rows = await SessionTracking.aggregate(pipeline).allowDiskUse(true);
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    session_type: normalizeLabel(r?.session_type, 'Unknown'),
    session_count: Number(r?.session_count || 0),
  }));
}

/**
 * PUBLIC_INTERFACE
 * computeMostLeastUsedServicesFlow
 *
 * Flow name: SessionTrackingAnalyticsFlow
 * Entry point for “Most used services” and “Least used services”.
 *
 * Inputs:
 * - tenantId, bypass, q (same semantics)
 * - maxItems?: number (default 5)
 *
 * Outputs:
 * - { mostUsed: Array<{ session_type, session_count }>, leastUsed: Array<{ session_type, session_count }> }
 *
 * Invariants:
 * - mostUsed sorted desc by session_count
 * - leastUsed sorted asc by session_count, excluding zeros when possible (same logic as SessionsByType component)
 */
async function computeMostLeastUsedServicesFlow({ tenantId, bypass, q, maxItems = 5 }) {
  const byType = await computeSessionsByTypeFlow({ tenantId, bypass, q });
  const rows = Array.isArray(byType) ? byType : [];

  const safeMax = Math.max(0, Number(maxItems) || 5);

  const sortedDesc = [...rows].sort((a, b) => b.session_count - a.session_count);
  const nonZeroAsc = rows.filter((r) => r.session_count > 0).sort((a, b) => a.session_count - b.session_count);

  const mostUsed = sortedDesc.slice(0, safeMax);
  const leastSource = nonZeroAsc.length ? nonZeroAsc : [...rows].sort((a, b) => a.session_count - b.session_count);
  const leastUsed = leastSource.slice(0, safeMax);

  return { mostUsed, leastUsed };
}

module.exports = {
  buildSessionTrackingAnalyticsFilter,
  computeSessionsByOrganizationFlow,
  computeSessionsByTypeFlow,
  computeMostLeastUsedServicesFlow,
};
