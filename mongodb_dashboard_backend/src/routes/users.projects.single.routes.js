'use strict';

/**
 * PUBLIC_INTERFACE
 * Users Projects Single Route
 *
 * GET /api/users/:userId/projects
 * Returns distinct projects for a single user with last_activity.
 * Query:
 *  - organization_id (required) | tenant_id alias
 *  - from?: ISO datetime
 *  - to?: ISO datetime
 *
 * Notes:
 * - Mirrors the OpenAPI spec and aligns with the batch route for data shape.
 */

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { getDb } = require('../config/db'); // existing db helper if available

function normalizeStringId(v) {
  if (v == null) return null;
  try { return String(v); } catch { return null; }
}

function parseDateSafe(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function log(...args) {
  if ((process.env.REACT_APP_LOG_LEVEL || 'info') !== 'silent') {
    // eslint-disable-next-line no-console
    console.log('[users.projects.single]', ...args);
  }
}

router.get('/:userId/projects', async (req, res, next) => {
  try {
    const userId = normalizeStringId(req.params.userId);
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

    // Build match similar to batch
    const userIds = [userId];

    const baseAnd = [
      { $or: [{ tenant_id: tenant }, { organization_id: tenant }] },
      { $expr: { $in: [{ $toString: '$user_id' }, userIds] } },
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
          user_id: { $toString: '$user_id' },
          project_id: { $ifNull: [{ $toString: '$project_id' }, null] },
          project_name: { $ifNull: ['$project_name', null] },
          activity_time: { $ifNull: ['$last_updated', '$session_start'] },
        },
      },
      { $match: { project_id: { $ne: null } } },
      {
        $group: {
          _id: { user_id: '$user_id', project_id: '$project_id' },
          project_name: { $last: '$project_name' },
          last_activity: { $max: '$activity_time' },
        },
      },
      {
        $group: {
          _id: '$_id.user_id',
          projects: {
            $push: {
              project_id: '$_id.project_id',
              project_name: '$project_name',
              last_activity: '$last_activity',
            },
          },
        },
      },
      { $project: { _id: 0, user_id: '$_id', projects: 1 } },
    ];

    const coll = db.collection('session_tracking');
    const result = await coll.aggregate(pipeline, { allowDiskUse: true }).toArray();

    const payload = result && result[0]
      ? {
          user_id: result[0].user_id,
          tenant_id: String(tenant),
          projects: (result[0].projects || []).map((p) => ({
            project_id: normalizeStringId(p.project_id),
            project_name: p.project_name || null,
            last_activity: p.last_activity ? new Date(p.last_activity) : null,
          })),
        }
      : { user_id: userId, tenant_id: String(tenant), projects: [] };

    log('single projects', { userId, tenant, count: payload.projects.length });

    return res.status(200).json(payload);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error in GET /api/users/:userId/projects', err);
    return next(err);
  }
});

module.exports = router;
