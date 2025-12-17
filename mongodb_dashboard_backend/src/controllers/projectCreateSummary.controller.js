'use strict';

const mongoose = require('mongoose');
const SessionTracking = require('../models/sessionTracking.model');

/**
 * PUBLIC_INTERFACE
 * Handler for GET /api/project-create/summary
 * Returns aggregated counts of session tracking documents grouped by project for a given organization.
 *
 * Query parameters:
 * - organizationId (string, required): Tenant/organization identifier used to filter records. Aliases: organization_id, tenant_id.
 * - from (ISO datetime, optional): Lower bound for time filter applied to last_updated or session_start.
 * - to (ISO datetime, optional): Upper bound for time filter applied to last_updated or session_start.
 * - range (string, optional): One of daily|weekly|monthly. When provided and from/to are not set, applies a default window of 1/7/30 days ending at now.
 * - status (string, optional): Pipe-separated status filter (e.g., "completed|active").
 *
 * Response:
 * {
 *   "buckets": [
 *     { "key": "projA", "label": "Project A", "count": 12 },
 *     { "key": "projB", "label": "Project B", "count": 3 }
 *   ]
 * }
 */
async function getProjectCreateSummary(req, res) {
  try {
    // Resolve organization id from query (supporting common aliases)
    const orgId =
      req.query.organizationId ||
      req.query.organization_id ||
      req.query.tenant_id;

    if (!orgId) {
      return res.status(400).json({
        error:
          'organizationId is required (query: organizationId | organization_id | tenant_id)',
      });
    }

    // Build base filter, enforce tenant/organization
    const filter = {
      $or: [{ organization_id: orgId }, { tenant_id: orgId }],
    };

    // Optional status filter (pipe separated)
    if (req.query.status) {
      const statuses = String(req.query.status)
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
      if (statuses.length > 0) {
        filter.status = { $in: statuses };
      }
    }

    // Date filters: from/to or range (daily/weekly/monthly)
    const timeRange = {};
    let from = req.query.from ? new Date(req.query.from) : null;
    let to = req.query.to ? new Date(req.query.to) : null;

    const range = (req.query.range || '').toString().toLowerCase();
    if (
      (!from || isNaN(from.getTime())) &&
      (!to || isNaN(to.getTime())) &&
      ['daily', 'weekly', 'monthly'].includes(range)
    ) {
      const now = new Date();
      const end = now;
      let days = 1;
      if (range === 'weekly') days = 7;
      if (range === 'monthly') days = 30;
      const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
      from = start;
      to = end;
    }

    if (from && !isNaN(from.getTime())) {
      timeRange.$gte = from;
    }
    if (to && !isNaN(to.getTime())) {
      timeRange.$lte = to;
    }
    if (Object.keys(timeRange).length > 0) {
      // Apply on last_updated or session_start if present
      filter.$and = [
        {
          $or: [{ last_updated: timeRange }, { session_start: timeRange }],
        },
      ];
    }

    // Build aggregation: group by project id from session_tracking
    // Support either project_id or projectId (fallback) by normalizing in $project prior to grouping
    const pipeline = [
      { $match: filter },
      {
        $project: {
          projectIdNorm: {
            $ifNull: ['$project_id', '$projectId'],
          },
        },
      },
      {
        $group: {
          _id: '$projectIdNorm',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ];

    // Attempt optional lookup to Projects collection for project_name.
    // Keep minimal and resilient: if collection doesn't exist or fails, skip and return null labels.
    let buckets = [];
    try {
      const items = await SessionTracking.aggregate(pipeline)
        .allowDiskUse(true)
        .exec();

      // Default label = null or same as id when not found
      buckets = items.map((it) => ({
        key: it._id,
        label: it._id ?? null,
        count: it.count,
      }));

      // Check if Projects model/collection exists and perform minimal lookup
      // Avoid requiring the model; use mongoose connection to list collections safely.
      const conn = mongoose.connection;
      if (conn && conn.db) {
        const collections = await conn.db.listCollections().toArray();
        const hasProjects =
          collections.findIndex(
            (c) =>
              c.name === 'projects' ||
              c.name === 'project' ||
              c.name === 'Projects'
          ) !== -1;

        if (hasProjects && buckets.length > 0) {
          // Fetch names for found project ids
          const projectIds = buckets
            .map((b) => b.key)
            .filter((id) => id !== null && id !== undefined);

          if (projectIds.length > 0) {
            const ProjectsCol = conn.collection('projects');
            // Prefer fields project_id + project_name; also check name/title as fallbacks
            const projDocs = await ProjectsCol
              .find({ project_id: { $in: projectIds } })
              .project({
                project_id: 1,
                project_name: 1,
                name: 1,
                title: 1,
              })
              .toArray();

            const nameById = new Map(
              projDocs.map((d) => [
                d.project_id,
                d.project_name || d.name || d.title || null,
              ])
            );

            buckets = buckets.map((b) => {
              const label =
                b.key == null ? null : nameById.get(b.key) ?? b.key;
              return { ...b, label };
            });
          }
        } else {
          // If no projects collection, set label to null when key is present but unknown
          buckets = buckets.map((b) => ({
            ...b,
            label: b.key == null ? null : b.key,
          }));
        }
      }
    } catch (aggErr) {
      // Fallback on any aggregation/lookup error: return minimal info with null labels
      console.error('Aggregation/lookup error in projectCreateSummary:', aggErr);
      const items = await SessionTracking.aggregate(pipeline)
        .allowDiskUse(true)
        .exec();
      buckets = items.map((it) => ({
        key: it._id,
        label: it._id ?? null,
        count: it.count,
      }));
    }

    return res.json({
      buckets,
    });
  } catch (err) {
    console.error('GET /api/project-create/summary error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  // PUBLIC_INTERFACE
  getProjectCreateSummary,
};
