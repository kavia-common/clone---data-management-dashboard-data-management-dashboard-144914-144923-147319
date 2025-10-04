const SessionTracking = require('../models/sessionTracking.model');
const Project = require('../models/project.model');

/**
 * PUBLIC_INTERFACE
 * getUserProjectsFromSessions
 * Aggregates distinct projects for a given user within a tenant using session_tracking data.
 * - Matches by tenant_id and user_id (normalized via $toString for consistency).
 * - Optional time range filters on timestamp/session_start/session_end.
 * - Returns unique projects with optional last activity timestamp and optional project_name (if found in projects collection).
 *
 * @param {Object} params
 * @param {string} params.tenantId - Required tenant identifier.
 * @param {string|number|Object} params.userId - User identifier (will be normalized to string for matching).
 * @param {string|Date} [params.from] - Optional ISO date or Date for start of time range.
 * @param {string|Date} [params.to] - Optional ISO date or Date for end of time range.
 * @returns {Promise<{ user_id: string, tenant_id: string, projects: Array<{ project_id: string, project_name?: string|null, last_activity?: string|null }> }>}
 */
async function getUserProjectsFromSessions({ tenantId, userId, from, to }) {
  const userIdString = String(userId);

  // Build time range constraints; prefer 'timestamp' if present; fall back to session_start/last_updated range.
  // We will match if any of these fields are within range using $or to be permissive.
  const timeClauses = [];
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  if (fromDate || toDate) {
    const makeRange = (field) => {
      const r = {};
      if (fromDate) r.$gte = fromDate;
      if (toDate) r.$lte = toDate;
      return { [field]: r };
    };
    // If only from or only to, still include appropriate bound
    timeClauses.push(makeRange('timestamp')); // Some datasets include a generic timestamp
    timeClauses.push(makeRange('session_start'));
    timeClauses.push(makeRange('last_updated'));
  }

  const matchStage = {
    $match: {
      tenant_id: tenantId,
      $expr: { $eq: [{ $toString: '$user_id' }, userIdString] },
      ...(timeClauses.length
        ? { $or: timeClauses.map((clause) => {
            // Remove empty range objects (e.g., when neither bound applied) - safe guard
            const key = Object.keys(clause)[0];
            const cond = clause[key];
            if (!cond.$gte && !cond.$lte) return { [key]: { $exists: true } };
            return clause;
          }) }
        : {}),
    },
  };

  const pipeline = [
    matchStage,
    {
      $group: {
        _id: '$project_id',
        last_activity: {
          // Consider last_updated, session_end, timestamp, session_start to find the latest activity
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

  // Optional lookup: enrich with project_name from projects collection when available
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
    .filter((g) => !!g.project_id) // ignore null/empty project ids
    .map((g) => ({
      project_id: g.project_id,
      project_name: Object.prototype.hasOwnProperty.call(projectNamesMap, g.project_id)
        ? projectNamesMap[g.project_id]
        : undefined, // omit if not available to keep response minimal
      last_activity: g.last_activity ? new Date(g.last_activity).toISOString() : undefined,
    }));

  return {
    user_id: userIdString,
    tenant_id: tenantId,
    projects,
  };
}

module.exports = {
  getUserProjectsFromSessions,
};
