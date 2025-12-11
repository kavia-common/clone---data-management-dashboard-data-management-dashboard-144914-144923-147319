'use strict';

/**
 * PUBLIC_INTERFACE
 * Users Projects Details Route
 *
 * GET /api/users/:userId/project-details
 * Returns distinct projects for a single user with resolved project_name via projects.service.
 * Query:
 *  - organization_id (required) | tenant_id alias
 *  - from?: ISO datetime
 *  - to?: ISO datetime
 *
 * Response:
 *  {
 *    userId: string,
 *    projects: [{ project_id: string, project_name: string|null }]
 *  }
 *
 * Notes:
 * - Uses session_tracking as source of distinct project_id activity
 * - Robust to empty states (returns projects: [])
 */

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { getDb } = require('../config/db');
const { resolveProjectNames } = require('../services/projects.service');

function asString(v) {
  if (v == null) return null;
  try { return String(v); } catch { return null; }
}
function parseDateSafe(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

router.get('/:userId/project-details', async (req, res, next) => {
  try {
    const userId = asString(req.params.userId);
    const tenant = req.query.organization_id || req.query.tenant_id || req.headers['x-organization-id'];
    const fromDate = parseDateSafe(req.query.from);
    const toDate = parseDateSafe(req.query.to);

    if (!userId) return res.status(400).json({ error: 'Invalid userId' });
    if (!tenant) return res.status(400).json({ error: 'organization_id (or tenant_id) is required' });
    if ((req.query.from && !fromDate) || (req.query.to && !toDate)) {
      return res.status(400).json({ error: 'Invalid from/to date value(s)' });
    }

    const db = getDb ? getDb() : mongoose.connection.db;
    if (!db) return res.status(503).json({ error: 'Database not connected' });

    // Build match filter (mirror existing users.projects.single but lighter projection)
    const baseAnd = [
      { $or: [{ tenant_id: tenant }, { organization_id: tenant }] },
      { $expr: { $eq: [{ $toString: '$user_id' }, userId] } },
    ];

    let timeOr = null;
    if (fromDate || toDate) {
      const range = {};
      if (fromDate) range.$gte = fromDate;
      if (toDate) range.$lte = toDate;
      timeOr = [
        { $and: [{ last_updated: { $type: 'date' } }, { last_updated: range }] },
        { $and: [{ $or: [{ last_updated: { $exists: false } }, { last_updated: null }] }, { session_start: range }] },
      ];
    }
    const match = timeOr ? { $and: [...baseAnd, { $or: timeOr }] } : { $and: baseAnd };

    const pipeline = [
      { $match: match },
      {
        $project: {
          project_id: { $ifNull: [{ $toString: '$project_id' }, null] },
        },
      },
      { $match: { project_id: { $ne: null } } },
      { $group: { _id: '$project_id' } },
      { $limit: 200 } // basic cap to avoid very large lists
    ];

    const coll = db.collection('session_tracking');
    const rows = await coll.aggregate(pipeline, { allowDiskUse: true }).toArray();
    const projectIds = rows.map(r => asString(r._id)).filter(Boolean);

    // Resolve names using service (cached, robust)
    const nameMap = await resolveProjectNames(projectIds);
    const projects = projectIds.map(pid => ({
      project_id: pid,
      project_name: nameMap.has(pid) ? nameMap.get(pid) : null,
    }));

    return res.status(200).json({
      userId,
      projects,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('GET /api/users/:userId/project-details error', err);
    return next(err);
  }
});

module.exports = router;
