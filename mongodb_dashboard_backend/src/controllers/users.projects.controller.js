'use strict';

/**
 * Controller for user projects derived from session tracking.
 * Reads userId from params; tenant_id (required) and optional from/to (ISO datetime) from query.
 * Aggregates distinct projects for the user within the tenant from session_tracking, and returns:
 * {
 *   user_id,
 *   tenant_id,
 *   projects: [{ project_id, project_name|null, last_activity|null }]
 * }
 */

const SessionTracking = require('../models/sessionTracking.model');
const AppDeployment = require('../models/appDeployments.model');

/**
 * Normalize a value to ISO string if it's a valid date, else null.
 * @param {Date|string|number|null|undefined} d
 * @returns {string|null}
 */
function toIsoOrNull(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

/**
 * Extract projectId variants from a session tracking doc safely.
 * @param {object} doc
 * @returns {string|null}
 */
function pickProjectId(doc) {
  if (!doc) return null;
  // Common fields we support
  const candidates = [
    doc.project_id,
    doc.projectId,
    doc.project?.id,
    doc.project?.projectId,
    doc.metadata?.projectId,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c;
  }
  // fallbacks: sometimes nested strings
  if (doc.project && typeof doc.project === 'string' && doc.project.trim()) {
    return doc.project.trim();
  }
  return null;
}

/**
 * Resolve a display name for a project from an AppDeployment-like doc.
 * @param {object} d
 * @returns {string|null}
 */
function pickProjectNameFromDeployment(d) {
  if (!d) return null;
  const candidates = [
    d.projectName,
    d.project_name,
    d.metadata?.projectName,
    d.metadata?.name,
    d.project?.name,
    d.project?.projectName,
    d.name,
    d.title,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c;
  }
  return null;
}

// PUBLIC_INTERFACE
async function getUserProjects(req, res, next) {
  /** This endpoint returns distinct projects the user has activity in, based on the session_tracking collection.
   * Params:
   *  - path: userId (string, required)
   *  - query: tenant_id (string, required), from (ISO, optional), to (ISO, optional)
   * Response:
   *  {
   *    user_id: string,
   *    tenant_id: string,
   *    projects: [{ project_id: string, project_name: string|null, last_activity: string|null }]
   *  }
   */
  try {
    const { userId } = req.params || {};
    const { tenant_id, from, to } = req.query || {};

    if (!userId || !tenant_id) {
      return res.status(400).json({
        message: 'Missing required parameters: userId (path) and tenant_id (query) are required.',
      });
    }

    // Build match filter
    const match = {
      tenant_id: tenant_id,
      // normalize user id against multiple potential fields in session tracking
      $or: [
        { user_id: String(userId) },
        { userId: String(userId) },
        { 'user.id': String(userId) },
        { 'metadata.userId': String(userId) },
      ],
    };

    // Time range (prefer last_updated; fall back to session_start)
    const timeBounds = {};
    if (from) {
      const f = new Date(from);
      if (isNaN(f.getTime())) {
        return res.status(400).json({ message: 'Invalid "from" datetime. Provide ISO format.' });
      }
      timeBounds.$gte = f;
    }
    if (to) {
      const t = new Date(to);
      if (isNaN(t.getTime())) {
        return res.status(400).json({ message: 'Invalid "to" datetime. Provide ISO format.' });
      }
      timeBounds.$lte = t;
    }
    if (Object.keys(timeBounds).length > 0) {
      // We create a predicate that checks either last_updated or session_start within bounds.
      match.$and = [
        {
          $or: [
            { last_updated: timeBounds },
            { session_start: timeBounds },
          ],
        },
      ];
    }

    // Aggregate distinct projects and compute last_activity
    const pipeline = [
      { $match: match },
      {
        $addFields: {
          normalized_project_id: {
            $ifNull: [
              '$project_id',
              {
                $ifNull: [
                  '$projectId',
                  {
                    $ifNull: [
                      '$project.id',
                      { $ifNull: ['$metadata.projectId', '$project'] },
                    ],
                  },
                ],
              },
            ],
          },
          activity_ts: {
            $ifNull: ['$last_updated', '$session_start'],
          },
        },
      },
      // Exclude null/empty ids
      {
        $match: {
          normalized_project_id: { $type: 'string', $ne: '' },
        },
      },
      {
        $group: {
          _id: '$normalized_project_id',
          last_activity: { $max: '$activity_ts' },
        },
      },
      {
        $project: {
          _id: 0,
          project_id: '$_id',
          last_activity: 1,
        },
      },
      { $sort: { project_id: 1 } },
    ];

    const agg = await SessionTracking.aggregate(pipeline).allowDiskUse(true);

    // Optional resolution of project_name from AppDeployments as a best-effort
    // We'll attempt to find a single deployment per projectId (various fields)
    const projectIds = agg.map((p) => p.project_id);
    let namesByProject = {};
    if (projectIds.length > 0 && AppDeployment && typeof AppDeployment.aggregate === 'function') {
      const deploymentLookup = await AppDeployment.aggregate([
        {
          $match: {
            $or: [
              { projectId: { $in: projectIds } },
              { project_id: { $in: projectIds } },
              { 'metadata.projectId': { $in: projectIds } },
              { 'project.id': { $in: projectIds } },
            ],
          },
        },
        // Prioritize more recent by created_at/updated_at if present
        {
          $addFields: {
            _sort_ts: { $ifNull: ['$updated_at', '$created_at'] },
          },
        },
        { $sort: { _sort_ts: -1 } },
        {
          $group: {
            _id: {
              $cond: [
                { $ifNull: ['$projectId', false] },
                '$projectId',
                {
                  $cond: [
                    { $ifNull: ['$project_id', false] },
                    '$project_id',
                    {
                      $cond: [
                        { $ifNull: ['$metadata.projectId', false] },
                        '$metadata.projectId',
                        '$project.id',
                      ],
                    },
                  ],
                },
              ],
            },
            doc: { $first: '$$ROOT' },
          },
        },
        {
          $project: {
            _id: 0,
            project_id: '$_id',
            doc: 1,
          },
        },
      ]).allowDiskUse(true);

      namesByProject = (deploymentLookup || []).reduce((acc, row) => {
        acc[row.project_id] = pickProjectNameFromDeployment(row.doc);
        return acc;
      }, {});
    }

    const items = agg.map((p) => ({
      project_id: p.project_id,
      project_name: namesByProject[p.project_id] ?? null,
      last_activity: toIsoOrNull(p.last_activity),
    }));

    return res.json({
      user_id: String(userId),
      tenant_id,
      projects: items,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  // Ensure exported first as requested
  getUserProjects,
};
