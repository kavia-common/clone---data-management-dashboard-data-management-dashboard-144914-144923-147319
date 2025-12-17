'use strict';

const mongoose = require('mongoose');
const SessionTracking = require('../models/sessionTracking.model');
const Project = require('../models/project.model');

/**
 * PUBLIC_INTERFACE
 * getProjectsCreateSummary
 * Returns aggregated SessionTracking counts grouped by project with tenant filtering and optional time/field filters.
 * Response:
 *   { buckets: [{ key: projectId, label: projectNameOrNull, count }] }
 *
 * Query params supported:
 * - organization_id | tenant_id | x-organization-id (header): tenant filter (optional but recommended)
 * - from, to: ISO date-time window (applies to timestamp/last_updated/session_start/created_at)
 * - filter: JSON string with whitelisted fields (status, provider, llm_model, user_id, session_id, project_id, request_id, service_type, container_id, task_id)
 */
async function getProjectsCreateSummary(req, res) {
  try {
    const {
      organization_id,
      tenant_id,
      from,
      to,
      filter,
    } = req.query;

    const orgId =
      organization_id ||
      tenant_id ||
      req.headers['x-organization-id'] ||
      req.headers['x-tenant-id'] ||
      null;

    // Build match stage
    const matchStage = {};
    if (orgId) {
      // Support documents that may use either organization_id or tenant_id
      matchStage.$or = [{ organization_id: orgId }, { tenant_id: orgId }];
    }

    // Time window on common fields (only when provided)
    if (from || to) {
      const timeCond = {};
      if (from) timeCond.$gte = new Date(from);
      if (to) timeCond.$lte = new Date(to);

      matchStage.$and = (matchStage.$and || []).concat([
        {
          $or: [
            { timestamp: timeCond },
            { last_updated: timeCond },
            { session_start: timeCond },
            { created_at: timeCond },
          ],
        },
      ]);
    }

    // Parse JSON filter and whitelist fields
    if (filter) {
      try {
        const parsed = typeof filter === 'string' ? JSON.parse(filter) : filter;
        const allowed = [
          'status',
          'provider',
          'llm_model',
          'user_id',
          'session_id',
          'project_id',
          'request_id',
          'service_type',
          'container_id',
          'task_id',
        ];
        for (const key of allowed) {
          if (Object.prototype.hasOwnProperty.call(parsed, key)) {
            const val = parsed[key];
            if (val !== undefined && val !== null && val !== '') {
              matchStage[key] = val;
            }
          }
        }
      } catch (e) {
        return res.status(400).json({ error: 'Invalid filter JSON' });
      }
    }

    // Aggregate grouped by normalized project id
    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: {
            $ifNull: [
              '$project_id',
              {
                $ifNull: ['$projectId', '$project.id'],
              },
            ],
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ];

    const results = await SessionTracking.aggregate(pipeline).allowDiskUse(true);

    // Optional project name lookup via Project model on multiple possible id fields
    const projectIds = results.map((r) => r._id).filter(Boolean);
    let nameMap = {};
    if (projectIds.length) {
      try {
        const projects = await Project.find({
          $or: [
            { project_id: { $in: projectIds } },
            { projectId: { $in: projectIds } },
            { 'project.id': { $in: projectIds } },
            { id: { $in: projectIds } },
          ],
        }).select('project_id projectId name title display_name project id');

        nameMap = projects.reduce((acc, p) => {
          const possibleId = p.project_id || p.projectId || (p.project && p.project.id) || p.id;
          const label =
            p.name ||
            p.title ||
            p.display_name ||
            (p.project && p.project.name) ||
            null;
          if (possibleId) acc[String(possibleId)] = label;
          return acc;
        }, {});
      } catch (e) {
        // If lookup fails, we still return buckets with null labels
        // eslint-disable-next-line no-console
        console.warn('Project name lookup failed, returning ids as labels:', e?.message || e);
      }
    }

    const buckets = results.map((r) => {
      const key = r._id == null ? 'unknown' : String(r._id);
      return {
        key,
        label: nameMap[key] ?? null,
        count: r.count,
      };
    });

    return res.json({ buckets });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error in getProjectsCreateSummary:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  // PUBLIC_INTERFACE
  getProjectsCreateSummary,
};
