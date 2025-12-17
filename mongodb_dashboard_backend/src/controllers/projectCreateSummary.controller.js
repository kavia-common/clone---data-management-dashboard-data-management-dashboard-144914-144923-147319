'use strict';

const mongoose = require('mongoose');
const SessionTracking = require('../models/sessionTracking.model');
const Project = require('../models/project.model');

/**
 * PUBLIC_INTERFACE
 * getProjectCreateSummary
 * Returns aggregated SessionTracking counts grouped by project with strict tenant filtering and optional time/status filters.
 * Response:
 *   { buckets: [{ key: <projectId>, label: <projectName|null>, count: <number> }] }
 *
 * Supported filters:
 * - Required tenant: organization_id | tenant_id | x-organization-id | x-tenant-id
 * - Time: either range=daily|weekly|monthly OR from/to (ISO). If range provided, compute implicit window:
 *      daily: last 1 day; weekly: last 7 days; monthly: last 30 days.
 * - Status: via ?status=a|b or JSON filter={"status":"a|b"} (pipe-separated values)
 * - Other fields ignored except status.
 */
async function getProjectCreateSummary(req, res) {
  try {
    const {
      organization_id,
      tenant_id,
      range,
      from,
      to,
      status,
      filter,
    } = req.query;

    // 1) Strict tenant scoping: organization required, otherwise 400
    const orgId =
      organization_id ||
      tenant_id ||
      req.headers['x-organization-id'] ||
      req.headers['x-tenant-id'] ||
      null;

    if (!orgId) {
      return res.status(400).json({ error: 'organization_id (or tenant_id/x-organization-id) is required' });
    }

    // 2) Build base match with strict tenant filter
    const matchStage = {
      $or: [{ organization_id: orgId }, { tenant_id: orgId }],
    };

    // Date range resolution:
    // - If range provided: map to default windows
    // - Else, use explicit from/to when provided
    let fromDate = null;
    let toDate = null;

    const now = new Date();
    if (range && ['daily', 'weekly', 'monthly'].includes(String(range))) {
      if (range === 'daily') {
        fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        toDate = now;
      } else if (range === 'weekly') {
        fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        toDate = now;
      } else if (range === 'monthly') {
        fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        toDate = now;
      }
    } else {
      if (from) fromDate = new Date(from);
      if (to) toDate = new Date(to);
    }

    if (fromDate || toDate) {
      const timeCond = {};
      if (fromDate) timeCond.$gte = fromDate;
      if (toDate) timeCond.$lte = toDate;
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

    // 3) Optional status filters
    // Accept ?status=completed|active OR filter JSON with "status"
    let statuses = null;
    // parse from status param
    if (typeof status === 'string' && status.trim()) {
      statuses = status.split('|').map((s) => s.trim()).filter(Boolean);
    }
    // parse from filter JSON if present
    if (filter) {
      try {
        const parsed = typeof filter === 'string' ? JSON.parse(filter) : filter;
        if (parsed && typeof parsed.status === 'string' && parsed.status.trim()) {
          statuses = (parsed.status || '')
            .split('|')
            .map((s) => s.trim())
            .filter(Boolean);
        }
      } catch {
        return res.status(400).json({ error: 'Invalid filter JSON' });
      }
    }
    if (Array.isArray(statuses) && statuses.length) {
      matchStage.status = { $in: statuses };
    }

    // 4) Aggregation: group by normalized project id
    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: {
            $ifNull: [
              '$project_id',
              { $ifNull: ['$projectId', '$project.id'] },
            ],
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ];

    const results = await SessionTracking.aggregate(pipeline).allowDiskUse(true);

    // 5) Optional lookup for project names using Projects collection if available
    const projectIds = results.map((r) => r._id).filter((v) => v != null);
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
        }).select('project_id projectId project_name name title display_name project id');
        nameMap = projects.reduce((acc, p) => {
          const pid = p.project_id || p.projectId || (p.project && p.project.id) || p.id;
          const label =
            p.project_name ||
            p.name ||
            p.title ||
            p.display_name ||
            (p.project && p.project.name) ||
            null;
          if (pid) acc[String(pid)] = label;
          return acc;
        }, {});
      } catch (e) {
        // Optional only; proceed with null labels if lookup fails
        try { console.warn('Project lookup skipped:', e?.message || e); } catch {}
      }
    }

    // 6) Response shape exactly as required
    const buckets = results.map((r) => {
      const key = r._id == null ? null : String(r._id);
      return {
        key,
        label: key ? (nameMap[key] ?? null) : null,
        count: r.count,
      };
    });

    return res.json({ buckets });
  } catch (error) {
    try { console.error('Error in getProjectCreateSummary:', error); } catch {}
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  // PUBLIC_INTERFACE
  getProjectCreateSummary,
};
