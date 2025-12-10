'use strict';

const SessionTracking = require('../models/sessionTracking.model');
const Project = require('../models/project.model');

/**
 * PUBLIC_INTERFACE
 * getUserProjectsFromSessions
 * Aggregates distinct projects for a given user within a tenant using session_tracking data.
 */
async function getUserProjectsFromSessions({ tenantId, userId, from, to, req = undefined }) {
  const userIdString = String(userId);

  const timeClauses = [];
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  if (fromDate || toDate) {
    const makeRange = (field) => {
      const r = {};
      if (fromDate) {r.$gte = fromDate;}
      if (toDate) {r.$lte = toDate;}
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
            if (!cond.$gte && !cond.$lte) {return { [key]: { $exists: true } };}
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

  const projectIds = grouped.map((g) => g.project_id).filter(Boolean);
  let projectNamesMap = {};
  if (projectIds.length > 0) {
    const projects = await Project.find({ project_id: { $in: projectIds } }, { project_id: 1, project_name: 1 }).lean();
    projectNamesMap = projects.reduce((acc, p) => {
      acc[p.project_id] = p.project_name || null;
      return acc;
    }, {});
  }

  const projects = grouped
    .filter((g) => !!g.project_id)
    .map((g) => ({
      project_id: g.project_id,
      project_name: Object.prototype.hasOwnProperty.call(projectNamesMap, g.project_id)
        ? projectNamesMap[g.project_id]
        : undefined,
      last_activity: g.last_activity ? new Date(g.last_activity).toISOString() : undefined,
    }));
  // If no projects, return an empty array (not null/undefined) to guarantee stable client behavior.
   // console.debug('[users.service] projects output sample:', projects.slice(0, 2));
  return {
    user_id: userIdString,
    tenant_id: tenantId,
    projects,
  };
}

const usersService = { getUserProjectsFromSessions };
module.exports = usersService;
