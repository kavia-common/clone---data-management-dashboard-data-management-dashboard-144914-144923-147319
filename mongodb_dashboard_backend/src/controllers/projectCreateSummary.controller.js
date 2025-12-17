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
 * - status (string, optional): Pipe-separated status filter (e.g., "completed|active").
 *
 * Response:
 * {
 *   "items": [
 *     { "project_id": "projA", "count": 12 },
 *     { "project_id": "projB", "count": 3 }
 *   ],
 *   "totalProjects": 2,
 *   "filters": { ...effective filters... }
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
        error: 'organizationId is required (query: organizationId | organization_id | tenant_id)',
      });
    }

    // Build base filter
    const filter = {
      $or: [
        { organization_id: orgId },
        { tenant_id: orgId },
      ],
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

    // Optional time range: prefer last_updated, fallback to session_start
    const timeRange = {};
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    if (from && !isNaN(from.getTime())) {
      timeRange.$gte = from;
    }
    if (to && !isNaN(to.getTime())) {
      timeRange.$lte = to;
    }
    if (Object.keys(timeRange).length > 0) {
      // Create an $or to apply range on last_updated or session_start
      filter.$and = [
        {
          $or: [
            { last_updated: timeRange },
            { session_start: timeRange },
          ],
        },
      ];
    }

    // Aggregation: group by project_id (null-safe), count
    const pipeline = [
      { $match: filter },
      {
        $group: {
          _id: {
            $ifNull: ['$project_id', null],
          },
          count: { $sum: 1 },
        },
      },
      // Sort descending by count
      { $sort: { count: -1 } },
      // Project output shape
      {
        $project: {
          _id: 0,
          project_id: '$_id',
          count: 1,
        },
      },
    ];

    const items = await SessionTracking.aggregate(pipeline).allowDiskUse(true).exec();

    return res.json({
      items,
      totalProjects: items.length,
      filters: {
        organizationId: orgId,
        status: req.query.status || null,
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
      },
    });
  } catch (err) {
    // Minimal error handling consistent with codebase style
    console.error('GET /api/project-create/summary error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  // PUBLIC_INTERFACE
  getProjectCreateSummary,
};
