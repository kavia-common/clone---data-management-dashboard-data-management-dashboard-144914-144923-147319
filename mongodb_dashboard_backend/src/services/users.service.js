'use strict';

const SessionTracking = require('../models/sessionTracking.model');
// Prefer resolving names via app_deployments through the shared projects.service
const { resolveProjectNames } = require('./projects.service');

/**
 * PUBLIC_INTERFACE
 * getUserProjectsFromSessions
 * Aggregates distinct projects for a given user within a tenant using session_tracking data.
 * Guarantees project_name is populated when resolvable from app_deployments (via projects.service),
 * else returns empty string (not null) for defensive handling.
 */
async function getUserProjectsFromSessions({ tenantId, userId, from, to, req = undefined }) {
  const userIdString = String(userId);

  const timeClauses = [];
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  if (fromDate || toDate) {
    const makeRange = (field) => {
      const r = {};
      if (fromDate) { r.$gte = fromDate; }
      if (toDate) { r.$lte = toDate; }
      return { [field]: r };
    };
    timeClauses.push(makeRange('timestamp'));
    timeClauses.push(makeRange('session_start'));
    timeClauses.push(makeRange('last_updated'));
  }

  const bypass = !!(req && (req.tenantScopeDisabled || req.allTenants || req?.user?.isSuperAdmin || req.usersAllTenantsBypass));
  try {
    if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
      // Route-level visibility: show when usersAllTenantsBypass is set
      console.debug(`[users.service] getUserProjectsFromSessions bypass=${bypass} (usersAllTenantsBypass=${!!(req && req.usersAllTenantsBypass)})`);
    }
  } catch {}
  const baseMatch = {
    $expr: { $eq: [{ $toString: '$user_id' }, userIdString] },
    ...(timeClauses.length
      ? {
          $or: timeClauses.map((clause) => {
            const key = Object.keys(clause)[0];
            const cond = clause[key];
            if (!cond.$gte && !cond.$lte) { return { [key]: { $exists: true } }; }
            return clause;
          }),
        }
      : {}),
  };

  const matchStage = {
    $match: bypass ? baseMatch : { ...baseMatch, tenant_id: tenantId },
  };

  const pipeline = [
    matchStage,
    {
      $group: {
        _id: '$project_id',
        last_activity: {
          $max: {
            $ifNull: [
              '$last_updated',
              { $ifNull: ['$session_end', { $ifNull: ['$timestamp', '$session_start'] }] },
            ],
          },
        },
      },
    },
    { $project: { _id: 0, project_id: '$_id', last_activity: 1 } },
    { $sort: { last_activity: -1 } },
  ];

  const grouped = await SessionTracking.aggregate(pipeline);

  // Collect projectIds and resolve names in batch via projects.service (uses app_deployments first)
  const projectIds = grouped.map((g) => g.project_id).filter(Boolean).map(String);
  let namesMap = new Map();
  if (projectIds.length > 0) {
    try {
      namesMap = await resolveProjectNames(projectIds);
    } catch (e) {
      // Keep namesMap empty on failure; downstream will default to empty string
      namesMap = new Map();
    }
  }

  const projects = grouped
    .filter((g) => !!g.project_id)
    .map((g) => {
      const pid = String(g.project_id);
      const resolved = namesMap.has(pid) ? namesMap.get(pid) : null;
      return {
        project_id: pid,
        // Ensure string; empty string when not found per requirement
        project_name: resolved ? String(resolved) : '',
        last_activity: g.last_activity ? new Date(g.last_activity).toISOString() : undefined,
      };
    });

  return {
    user_id: userIdString,
    tenant_id: tenantId,
    projects,
  };
}

const usersService = { getUserProjectsFromSessions };
module.exports = usersService;
