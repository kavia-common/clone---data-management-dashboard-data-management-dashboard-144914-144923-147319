'use strict';

/**
 * PUBLIC_INTERFACE
 * Users Projects Batch Routes
 * 
 * POST /api/users/projects
 * Accepts JSON: { userIds: string[], organization_id?: string, tenant_id?: string, from?: string|Date, to?: string|Date }
 * Validates input and returns a map keyed by userId each containing an array of distinct projects with last_activity.
 * 
 * Notes:
 * - Enforces a maximum userIds length to prevent excessive load (default 200).
 * - organization_id and tenant_id are aliases; organization_id takes precedence.
 * - Time range is optional; if provided, it applies to session activity timestamps.
 * - Uses a single MongoDB aggregation with $match and $group for efficiency.
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { getDb } = require('../config/db'); // existing db helper if available
const { standardJsonHandler } = require('../middleware/standardHandlers') || {};
const { requireTenantIfPresent } = require('../middleware/tenantScope') || {};
const { extractOrganization } = require('../middleware/extractOrganization') || {};
const cors = require('cors');

// Basic permissive CORS for this route only; aligns with REACT_APP_FRONTEND_URL if set
const FRONTEND_URL = process.env.REACT_APP_FRONTEND_URL;
const corsOptions = {
  origin: FRONTEND_URL ? [FRONTEND_URL, /\.kavia\.ai$/] : true,
  credentials: true,
};

// Simple logger
function log(...args) {
  if ((process.env.REACT_APP_LOG_LEVEL || 'info') !== 'silent') {
    // eslint-disable-next-line no-console
    console.log('[users.projects.batch]', ...args);
  }
}

// Helpers
function parseDateSafe(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function normalizeStringId(v) {
  if (v == null) return null;
  try {
    return String(v);
  } catch (_e) {
    return null;
  }
}

// Route: POST /api/users/projects
router.post(
  '/projects',
  cors(corsOptions),
  async (req, res, next) => {
    try {
      const MAX_USER_IDS = 200;

      const body = req.body || {};
      let { userIds, organization_id, tenant_id, from, to } = body;

      // Resolve tenant alias
      const tenant = organization_id || tenant_id || req.headers['x-organization-id'] || req.query.organization_id || req.query.tenant_id;

      // Validation: userIds array
      if (!Array.isArray(userIds)) {
        return res.status(400).json({ error: 'userIds must be an array of strings' });
      }
      userIds = userIds.map(normalizeStringId).filter(Boolean);
      if (userIds.length === 0) {
        return res.status(200).json({ success: true, data: {} });
      }
      if (userIds.length > MAX_USER_IDS) {
        return res.status(400).json({ error: `Too many userIds; maximum is ${MAX_USER_IDS}` });
      }

      // Validation: tenant required
      if (!tenant) {
        return res.status(400).json({ error: 'organization_id (or tenant_id) is required' });
      }

      // Parse dates (optional)
      const fromDate = parseDateSafe(from);
      const toDate = parseDateSafe(to);
      if ((from && !fromDate) || (to && !toDate)) {
        return res.status(400).json({ error: 'Invalid from/to date value(s)' });
      }

      // Build match filter on session_tracking
      // We assume collection name "session_tracking" based on existing codebase
      const db = getDb ? getDb() : mongoose.connection.db;
      if (!db) {
        return res.status(503).json({ error: 'Database not connected' });
      }

      const match = {
        // tenant scope
        $or: [
          { tenant_id: tenant },
          { organization_id: tenant },
        ],
        // user scope; user_id normalized to string
        $expr: { $in: [{ $toString: '$user_id' }, userIds] },
      };

      // Time window: prefer last_updated if available; else session_start
      const timeRange = {};
      if (fromDate) timeRange.$gte = fromDate;
      if (toDate) timeRange.$lte = toDate;
      if (Object.keys(timeRange).length) {
        match.$or = [
          {
            $and: [
              { last_updated: { $type: 'date' } },
              { last_updated: timeRange },
            ],
          },
          {
            $and: [
              { $or: [{ last_updated: { $exists: false } }, { last_updated: null }] },
              { session_start: timeRange },
            ],
          },
        ];
        // include tenant and user filters too
        match.$and = [
          { $or: [{ tenant_id: tenant }, { organization_id: tenant }] },
          { $expr: { $in: [{ $toString: '$user_id' }, userIds] } },
        ];
        // Remove earlier tenant/user keys to avoid conflicts
        delete match.$or[2];
      }

      // Aggregation pipeline
      const pipeline = [
        { $match: match },
        {
          $project: {
            user_id: { $toString: '$user_id' },
            project_id: {
              $ifNull: [
                { $toString: '$project_id' },
                null,
              ],
            },
            project_name: {
              $ifNull: ['$project_name', null],
            },
            activity_time: {
              $ifNull: ['$last_updated', '$session_start'],
            },
          },
        },
        // exclude records without a project id
        { $match: { project_id: { $ne: null } } },
        // compute last activity per (user_id, project_id)
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
        {
          $project: {
            _id: 0,
            user_id: '$_id',
            projects: 1,
          },
        },
      ];

      const coll = db.collection('session_tracking');
      const aggCursor = coll.aggregate(pipeline, { allowDiskUse: true });
      const results = await aggCursor.toArray();

      // Map results to dictionary keyed by userId
      const map = {};
      // Initialize all keys with empty arrays to handle empty results gracefully
      for (const uid of userIds) {
        map[uid] = [];
      }
      for (const row of results) {
        if (!row || !row.user_id) continue;
        map[row.user_id] = (row.projects || []).map(p => ({
          project_id: normalizeStringId(p.project_id),
          project_name: p.project_name || null,
          last_activity: p.last_activity ? new Date(p.last_activity) : null,
        }));
      }

      log('batch projects', {
        tenant,
        requested: userIds.length,
        matchedUsers: Object.keys(map).length,
      });

      return res.status(200).json({
        success: true,
        tenant_id: String(tenant),
        data: map,
        meta: {
          requestedUserIds: userIds.length,
          from: fromDate ? fromDate.toISOString() : null,
          to: toDate ? toDate.toISOString() : null,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error in POST /api/users/projects', err);
      return next(err);
    }
  }
);

module.exports = router;
