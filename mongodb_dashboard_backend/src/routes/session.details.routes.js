const express = require('express');
const router = express.Router();

const { getDb } = require('../config/db');
const { applyTenantScopeFromRequest } = require('../middleware/tenantScope');
const { parseISODate } = require('../utils/date');

/**
 * PUBLIC_INTERFACE
 * GET /api/sessions/details
 * Returns session breakdown for a given user_id with totals.
 *
 * Query params:
 * - user_id (string, required): The user identifier to filter sessions.
 * - tenant_id (string, optional): Tenant scope; enforced by middleware/JWT if enabled elsewhere.
 * - from (ISO date string, optional): Lower bound for session_start.
 * - to (ISO date string, optional): Upper bound for session_start.
 *
 * Response 200:
 * {
 *   sessions: [
 *     { session_start: ISOString, session_end: ISOString|null, duration: number }
 *   ],
 *   total_sessions: number,
 *   total_duration: number,
 *   duration_unit: "seconds",
 *   meta: { user_id: string, tenant_id?: string }
 * }
 */
router.get('/details', async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }

    const userId = (req.query.user_id || '').toString().trim();
    if (!userId) {
      return res.status(400).json({ error: 'Missing required query parameter: user_id' });
    }

    // Optional time range
    const from = req.query.from ? parseISODate(req.query.from) : null;
    const to = req.query.to ? parseISODate(req.query.to) : null;

    // Build base filter
    const filter = { user_id: userId };

    // Apply optional tenant scoping if header/query present elsewhere.
    // If project enforces tenant via JWT, this should be applied by middleware; here we honor explicit query/header.
    const tenantId = req.query.tenant_id || req.query.organization_id || req.header('x-organization-id');
    if (tenantId) {
      filter.tenant_id = tenantId;
    }

    // Apply time range on session_start if provided
    if (from || to) {
      filter.session_start = {};
      if (from) filter.session_start.$gte = from;
      if (to) filter.session_start.$lte = to;
    }

    const collectionCandidates = [
      'session_breakdown',
      'session_tracking',
      'session_trackings',
      'sessions',
      'session',
      'user_sessions'
    ];

    // pick the first existing collection
    let collectionName = null;
    const allCollections = await db.listCollections().toArray();
    const existingNames = new Set(allCollections.map(c => c.name));
    for (const name of collectionCandidates) {
      if (existingNames.has(name)) {
        collectionName = name;
        break;
      }
    }
    // If none match, fallback to a known collection name from repo (session_tracking exists per routes)
    if (!collectionName && existingNames.has('session_tracking')) {
      collectionName = 'session_tracking';
    }

    if (!collectionName) {
      // No collection available; return empty structure
      return res.json({
        sessions: [],
        total_sessions: 0,
        total_duration: 0,
        duration_unit: 'seconds',
        meta: { user_id: userId, tenant_id: tenantId || null, collection: null }
      });
    }

    const col = db.collection(collectionName);

    // Attempt to detect schema: session_start/session_end vs nested fields
    // We'll use aggregation and handle null ends using $$NOW.
    const pipeline = [
      { $match: filter },
      // Normalize fields that might be named differently
      {
        $addFields: {
          _start: {
            $ifNull: [
              '$session_start',
              { $ifNull: ['$start', '$started_at'] }
            ]
          },
          _end: {
            $ifNull: [
              '$session_end',
              { $ifNull: ['$end', '$ended_at'] }
            ]
          }
        }
      },
      // Replace null end with NOW
      {
        $addFields: {
          _effective_end: {
            $cond: [
              { $or: [{ $eq: ['$_end', null] }, { $not: ['$_end'] }] },
              '$$NOW',
              '$_end'
            ]
          }
        }
      },
      // Compute duration in seconds; if start missing, duration = 0
      {
        $addFields: {
          _duration: {
            $cond: [
              { $or: [{ $eq: ['$_start', null] }, { $not: ['$_start'] }] },
              0,
              {
                $dateDiff: {
                  startDate: '$_start',
                  endDate: '$_effective_end',
                  unit: 'second'
                }
              }
            ]
          }
        }
      },
      // Project sessions array item
      {
        $project: {
          session_start: '$_start',
          session_end: '$_end',
          duration: { $ifNull: ['$_duration', 0] }
        }
      },
      // Sort sessions by start descending
      { $sort: { session_start: -1 } }
    ];

    const sessions = await col.aggregate(pipeline).toArray();

    const total_sessions = sessions.length;
    const total_duration = sessions.reduce((acc, s) => acc + (typeof s.duration === 'number' ? s.duration : 0), 0);

    // Normalize date outputs to ISO strings
    const normalized = sessions.map(s => ({
      session_start: s.session_start ? new Date(s.session_start).toISOString() : null,
      session_end: s.session_end ? new Date(s.session_end).toISOString() : null,
      duration: s.duration || 0
    }));

    return res.json({
      sessions: normalized,
      total_sessions,
      total_duration,
      duration_unit: 'seconds',
      meta: { user_id: userId, tenant_id: tenantId || null, collection: collectionName }
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error in /api/sessions/details:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
