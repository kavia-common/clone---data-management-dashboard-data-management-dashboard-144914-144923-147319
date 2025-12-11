'use strict';

const SessionTracking = require('../models/sessionTracking.model');

/**
 * PUBLIC_INTERFACE
 * getUserProjectsFromSessions
 * Aggregates distinct projects for a given user within a tenant using session_tracking data.
 * Now enriches each project with project_name from app_deployments (preferred) using a $lookup join.
 * The lookup matches any of: projectId, project_id, metadata.projectId, project.id.
 * Falls back to any session-level project_name if present. If still unavailable, project_name is null.
 */
async function getUserProjectsFromSessions({ tenantId, userId, from, to, req = undefined }) {
  const userIdString = String(userId);

  const timeClauses = [];
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  if (fromDate || toDate) {
    const range = {};
    if (fromDate) range.$gte = fromDate;
    if (toDate) range.$lte = toDate;
    // Prefer last_updated/session_start/timestamp; allow any to match
    timeClauses.push({ last_updated: range });
    timeClauses.push({ session_start: range });
    timeClauses.push({ timestamp: range });
  }

  const bypass =
    !!(req && (req.tenantScopeDisabled || req.allTenants || req?.user?.isSuperAdmin || req.usersAllTenantsBypass));

  const baseMatch = {
    $expr: { $eq: [{ $toString: '$user_id' }, userIdString] },
    ...(timeClauses.length ? { $or: timeClauses } : {}),
  };

  const matchStage = {
    $match: bypass ? baseMatch : { ...baseMatch, tenant_id: tenantId },
  };

  // Build an aggregation that computes distinct {project_id, last_activity} then looks up name from app_deployments
  const pipeline = [
    matchStage,
    {
      $project: {
        project_id: { $ifNull: [{ $toString: '$project_id' }, null] },
        // capture any inline session-level name as weak fallback
        project_name_session: { $ifNull: ['$project_name', null] },
        activity_time: {
          $ifNull: ['$last_updated', { $ifNull: ['$session_end', { $ifNull: ['$timestamp', '$session_start'] }] }],
        },
      },
    },
    { $match: { project_id: { $ne: null } } },
    {
      $group: {
        _id: '$project_id',
        last_activity: { $max: '$activity_time' },
        project_name_session: { $first: '$project_name_session' },
      },
    },
    // Join app_deployments for canonical name by various id fields
    {
      $lookup: {
        from: 'app_deployments',
        let: { pid: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  { $eq: [{ $toString: '$project_id' }, '$$pid'] },
                  { $eq: [{ $toString: '$projectId' }, '$$pid'] },
                  { $eq: [{ $toString: '$metadata.projectId' }, '$$pid'] },
                  { $eq: [{ $toString: '$project.id' }, '$$pid'] },
                ],
              },
            },
          },
          { $sort: { updated_at: -1, created_at: -1, _id: -1 } },
          { $limit: 1 },
          {
            $project: {
              _id: 0,
              project_name_dep: {
                $ifNull: [
                  '$project_name',
                  {
                    $ifNull: [
                      '$projectName',
                      {
                        $ifNull: ['$metadata.projectName', '$project.name'],
                      },
                    ],
                  },
                ],
              },
            },
          },
        ],
        as: 'dep',
      },
    },
    {
      $addFields: {
        project_name: {
          $ifNull: [{ $arrayElemAt: ['$dep.project_name_dep', 0] }, '$project_name_session'],
        },
      },
    },
    {
      $project: {
        _id: 0,
        project_id: '$_id',
        project_name: 1,
        last_activity: 1,
      },
    },
    { $sort: { last_activity: -1 } },
  ];

  const projectsRaw = await SessionTracking.aggregate(pipeline).allowDiskUse(true);

  // Normalize to API contract: last_activity ISO string or null
  const projects = (projectsRaw || []).map((p) => ({
    project_id: p?.project_id,
    project_name: p?.project_name ?? null,
    last_activity: p?.last_activity ? new Date(p.last_activity).toISOString() : null,
  }));

  return {
    user_id: userIdString,
    tenant_id: tenantId,
    projects,
  };
}

const usersService = { getUserProjectsFromSessions };
module.exports = usersService;
