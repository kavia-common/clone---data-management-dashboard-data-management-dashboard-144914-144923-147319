'use strict';

/**
 * Users Projects Controller
 * Returns distinct projects the user has activity in, based on the session_tracking collection.
 * Applies required tenant scope (tenant_id / organization_id alias) and optional from/to datetime range filters.
 * 
 * PUBLIC_INTERFACE
 * @function getUserProjects
 * @description Express handler for GET /api/users/:userId/projects
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @returns {Promise<void>} JSON: { user_id, tenant_id, projects: [{ project_id, project_name|null, last_activity|null }] }
 */
const getUserProjects = async (req, res) => {
  try {
    const db = req.app.locals.db;
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }

    const { userId } = req.params;
    const { tenant_id, organization_id, from, to } = req.query;

    // Tenant scoping – accept tenant_id (preferred) or organization_id alias
    const tenantId = tenant_id || organization_id;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenant_id is required' });
    }

    // Normalize user id to string for matching
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const sessionCol = db.collection('session_tracking');

    // Build match filter
    const timestampFields = ['last_updated', 'timestamp', 'session_end', 'session_start', 'created_at'];
    const match = {
      $and: [
        { $or: [{ tenant_id: tenantId }, { organization_id: tenantId }] },
        { $or: [{ user_id: normalizedUserId }, { userId: normalizedUserId }] },
      ],
    };

    // Apply date filters if provided - build a clause that checks across known timestamp fields
    const dateRange = {};
    if (from) {
      const fromDate = new Date(from);
      if (isNaN(fromDate.getTime())) {
        return res.status(400).json({ error: 'Invalid "from" date-time' });
      }
      dateRange.$gte = fromDate;
    }
    if (to) {
      const toDate = new Date(to);
      if (isNaN(toDate.getTime())) {
        return res.status(400).json({ error: 'Invalid "to" date-time' });
      }
      dateRange.$lte = toDate;
    }
    if (dateRange.$gte || dateRange.$lte) {
      // Create $or over all candidate timestamp fields
      const timeOr = timestampFields.map((f) => ({ [f]: dateRange }));
      match.$and.push({ $or: timeOr });
    }

    // Aggregation to compute distinct projects and last activity
    const pipeline = [
      { $match: match },
      {
        $addFields: {
          // Pick the best available timestamp field for activity
          activity_ts: {
            $ifNull: [
              '$last_updated',
              {
                $ifNull: [
                  '$timestamp',
                  {
                    $ifNull: [
                      '$session_end',
                      {
                        $ifNull: [
                          '$session_start',
                          '$created_at',
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
      // Only keep docs that have a project id of some kind
      {
        $match: {
          $or: [
            { project_id: { $exists: true, $ne: null } },
            { projectId: { $exists: true, $ne: null } },
            { 'project.id': { $exists: true, $ne: null } },
            { 'metadata.projectId': { $exists: true, $ne: null } },
          ],
        },
      },
      // Normalize fields for grouping
      {
        $addFields: {
          _project_id: {
            $ifNull: [
              '$project_id',
              {
                $ifNull: [
                  '$projectId',
                  {
                    $ifNull: [
                      '$project.id',
                      '$metadata.projectId',
                    ],
                  },
                ],
              },
            ],
          },
          _project_name: {
            $ifNull: [
              '$project_name',
              {
                $ifNull: [
                  '$project.name',
                  {
                    $ifNull: [
                      '$metadata.projectName',
                      null,
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
      // Group by project id to get last activity and one project name
      {
        $group: {
          _id: '$_project_id',
          last_activity: { $max: '$activity_ts' },
          project_name: { $first: '$_project_name' },
        },
      },
      // Shape output
      {
        $project: {
          _id: 0,
          project_id: { $toString: '$_id' },
          project_name: {
            $cond: [{ $gt: [{ $type: '$project_name' }, 'missing'] }, '$project_name', null],
          },
          last_activity: {
            $cond: [
              { $gt: [{ $type: '$last_activity' }, 'missing'] },
              '$last_activity',
              null,
            ],
          },
        },
      },
      { $sort: { last_activity: -1, project_id: 1 } },
    ];

    const items = await sessionCol.aggregate(pipeline, { allowDiskUse: true }).toArray();

    // Optionally, future enhancement: If project_name is null, try resolve from projects/app_deployments
    // For now, we return what we have from session_tracking to keep this endpoint fast.

    // Normalize last_activity to ISO
    const projects = items.map((p) => ({
      project_id: String(p.project_id),
      project_name: p.project_name ?? null,
      last_activity: p.last_activity ? new Date(p.last_activity).toISOString() : null,
    }));

    return res.status(200).json({
      user_id: normalizedUserId,
      tenant_id: tenantId,
      projects,
    });
  } catch (err) {
    // Basic error handling with safe message
    // eslint-disable-next-line no-console
    console.error('Error in getUserProjects:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  // PUBLIC_INTERFACE
  getUserProjects,
};
