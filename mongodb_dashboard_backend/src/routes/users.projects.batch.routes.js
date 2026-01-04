'use strict';

/**
 * PUBLIC_INTERFACE
 * Users Sessions Batch Aggregation Route (used by Users tab "Activity by User" chart)
 *
 * POST /api/users/projects
 *
 * Request body:
 *  {
 *    userIds: string[],
 *    organization_id?: string,   // alias: tenant_id
 *    tenant_id?: string,         // alias: organization_id
 *    from?: string|Date,         // ISO timestamp
 *    to?: string|Date            // ISO timestamp
 *  }
 *
 * Semantics (must match reference MongoDB query behavior):
 *  - Filters sessions by created_at within [from,to] inclusive using $gte/$lte.
 *  - Filters by tenant (organization_id/tenant_id) unless organization_id === 'T0000'
 *    (super-admin wildcard) in which case tenant filter is omitted.
 *  - Aggregates total session count per requested user_id (count of session documents).
 *  - Enriches with user_name from users collection when available.
 *
 * Response:
 *  {
 *    success: true,
 *    tenant_id: string|null, // echoed tenant selector; "T0000" when wildcard
 *    data: {
 *      [user_id: string]: { user_id, user_name, total_count, projects: [] }
 *    },
 *    meta: { requestedUserIds, chunkSize, chunks, from, to }
 *  }
 *
 * Notes:
 *  - No per-user calls: aggregation is done in bulk via MongoDB pipeline(s).
 *  - Handles large userIds lists safely via chunking and a configurable max size.
 */

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const router = express.Router();

const { getDb } = require('../config/db');

// Basic permissive CORS for this route only; aligns with REACT_APP_FRONTEND_URL if set
const FRONTEND_URL = process.env.REACT_APP_FRONTEND_URL;
const corsOptions = {
  origin: FRONTEND_URL ? [FRONTEND_URL, /\.kavia\.ai$/] : true,
  credentials: true,
};

function isT0000Like(val) {
  if (!val) return false;
  return String(val).trim().toUpperCase() === 'T0000';
}

function log(...args) {
  if ((process.env.REACT_APP_LOG_LEVEL || 'info') !== 'silent') {
    // eslint-disable-next-line no-console
    console.log('[users.projects.batch]', ...args);
  }
}

function logError(context, err) {
  // eslint-disable-next-line no-console
  console.error('[users.projects.batch] ERROR', {
    context,
    message: err?.message,
    name: err?.name,
    code: err?.code,
    stack: err?.stack,
  });
}

function parseDateSafe(val) {
  if (!val) return null;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeStringId(v) {
  if (v == null) return null;
  try {
    const s = String(v);
    return s.trim() ? s : null;
  } catch {
    return null;
  }
}

function chunkArray(arr, chunkSize) {
  const out = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    out.push(arr.slice(i, i + chunkSize));
  }
  return out;
}

function buildEmptyResponseMap(userIds) {
  const map = {};
  for (const uid of userIds) {
    map[uid] = { user_id: uid, user_name: null, total_count: 0, projects: [] };
  }
  return map;
}

/**
 * Aggregates session totals for a userIds chunk with optional user_name enrichment.
 * Returns rows: [{ user_id, user_name, total_count }]
 */
async function aggregateSessionsByUserChunk({ db, userIdsChunk, tenant, isAllTenants, fromDate, toDate }) {
  // Tenant filter is omitted entirely for T0000/all-tenants mode.
  const match = {};

  // created_at inclusive bounds
  const createdAtRange = {};
  if (fromDate) createdAtRange.$gte = fromDate;
  if (toDate) createdAtRange.$lte = toDate;
  if (Object.keys(createdAtRange).length) {
    match.created_at = createdAtRange;
  }

  // user filter: normalize stored user_id to string for matching against provided ids
  // NOTE: Use $expr+$toString so sessions.user_id may be ObjectId/Mixed.
  match.$expr = { $in: [{ $toString: '$user_id' }, userIdsChunk] };

  if (!isAllTenants) {
    // Match reference requirement: Filter by organization_id (tenant_id) unless T0000.
    // We support both tenant_id and organization_id fields on session docs.
    match.$and = [
      // Preserve existing match keys and add tenant clause without overwriting $expr/created_at
      // by keeping tenant clause inside $and.
      // (We also keep $expr at top-level; Mongo treats it as AND with other top-level keys.)
      {
        $or: [{ tenant_id: tenant }, { organization_id: tenant }],
      },
    ];
  }

  const pipeline = [
    { $match: match },
    // Group by normalized user_id string and count documents
    {
      $group: {
        _id: { $toString: '$user_id' },
        total_count: { $sum: 1 },
      },
    },
    // Optional enrichment: lookup user document by _id string.
    // Note: This assumes users._id is ObjectId; we compare using $toString.
    {
      $lookup: {
        from: 'users',
        let: { uid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: [{ $toString: '$_id' }, '$$uid'] } } },
          { $project: { _id: 0, user_name: { $ifNull: ['$user_name', { $ifNull: ['$name', null] }] } } },
          { $limit: 1 },
        ],
        as: 'u',
      },
    },
    {
      $project: {
        _id: 0,
        user_id: '$_id',
        user_name: { $ifNull: [{ $arrayElemAt: ['$u.user_name', 0] }, null] },
        total_count: 1,
      },
    },
  ];

  const sessionsCollectionName = process.env.SESSIONS_COLLECTION_NAME || 'sessions';
  const coll = db.collection(sessionsCollectionName);
  return coll.aggregate(pipeline, { allowDiskUse: true }).toArray();
}

// PUBLIC_INTERFACE
router.post('/projects', cors(corsOptions), async (req, res) => {
  const requestId =
    req.headers['x-request-id'] ||
    req.headers['x-correlation-id'] ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  try {
    const body = req.body || {};
    let { userIds, organization_id, tenant_id, from, to } = body;

    // Resolve tenant alias from body/header/query
    const tenantCandidate =
      organization_id ||
      tenant_id ||
      req.headers['x-organization-id'] ||
      req.query.organization_id ||
      req.query.tenant_id;

    const isAllTenants = isT0000Like(tenantCandidate);

    if (!Array.isArray(userIds)) {
      return res.status(400).json({ error: 'userIds must be an array of strings' });
    }

    userIds = userIds.map(normalizeStringId).filter(Boolean);

    if (userIds.length === 0) {
      return res.status(200).json({
        success: true,
        tenant_id: tenantCandidate ? String(tenantCandidate) : null,
        data: {},
        meta: { requestedUserIds: 0, from: null, to: null },
      });
    }

    // Tenant required UNLESS this is the super-admin wildcard (T0000).
    if (!tenantCandidate && !isAllTenants) {
      return res.status(400).json({ error: 'organization_id (or tenant_id) is required' });
    }

    const fromDate = parseDateSafe(from);
    const toDate = parseDateSafe(to);
    if ((from && !fromDate) || (to && !toDate)) {
      return res.status(400).json({ error: 'Invalid from/to date value(s)' });
    }

    const MAX_USER_IDS = Number(process.env.USERS_PROJECTS_BATCH_MAX_USER_IDS || 5000);
    const CHUNK_SIZE = Number(process.env.USERS_PROJECTS_BATCH_CHUNK_SIZE || 500);

    if (!Number.isFinite(MAX_USER_IDS) || MAX_USER_IDS < 1) {
      return res.status(500).json({ error: 'Server misconfigured: USERS_PROJECTS_BATCH_MAX_USER_IDS invalid' });
    }
    if (!Number.isFinite(CHUNK_SIZE) || CHUNK_SIZE < 1) {
      return res.status(500).json({ error: 'Server misconfigured: USERS_PROJECTS_BATCH_CHUNK_SIZE invalid' });
    }

    if (userIds.length > MAX_USER_IDS) {
      return res.status(413).json({
        error: `Too many userIds; maximum is ${MAX_USER_IDS}`,
      });
    }

    const db = getDb ? await getDb() : mongoose.connection.db;
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }

    const tenant = tenantCandidate ? String(tenantCandidate) : 'T0000';

    const chunks = chunkArray(userIds, CHUNK_SIZE);

    // Merged result maps
    const countsByUser = new Map(); // user_id -> number
    const namesByUser = new Map(); // user_id -> string|null

    for (const chunk of chunks) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await aggregateSessionsByUserChunk({
        db,
        userIdsChunk: chunk,
        tenant,
        isAllTenants,
        fromDate,
        toDate,
      });

      for (const r of rows || []) {
        const uid = normalizeStringId(r?.user_id);
        if (!uid) continue;

        const prev = countsByUser.get(uid) || 0;
        const next = prev + Number(r?.total_count || 0);
        countsByUser.set(uid, next);

        const nm = r?.user_name != null ? String(r.user_name) : null;
        if (nm && !namesByUser.get(uid)) {
          namesByUser.set(uid, nm);
        }
      }
    }

    // Ensure all requested users are present with total_count=0 if no sessions
    const data = buildEmptyResponseMap(userIds);
    for (const uid of userIds) {
      data[uid] = {
        user_id: uid,
        user_name: namesByUser.get(uid) || null,
        total_count: countsByUser.get(uid) || 0,
        projects: [],
      };
    }

    log('batch sessions-by-user ok', {
      requestId,
      tenant,
      isAllTenants,
      requestedUserIds: userIds.length,
      chunks: chunks.length,
      from: fromDate ? fromDate.toISOString() : null,
      to: toDate ? toDate.toISOString() : null,
    });

    res.set('X-Request-Id', String(requestId));
    return res.status(200).json({
      success: true,
      tenant_id: tenant,
      data,
      meta: {
        requestedUserIds: userIds.length,
        chunkSize: CHUNK_SIZE,
        chunks: chunks.length,
        from: fromDate ? fromDate.toISOString() : null,
        to: toDate ? toDate.toISOString() : null,
      },
    });
  } catch (err) {
    logError('POST /api/users/projects', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      requestId,
    });
  }
});

module.exports = router;
