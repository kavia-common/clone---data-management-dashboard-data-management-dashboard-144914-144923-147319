'use strict';

/**
 * PUBLIC_INTERFACE
 * Users Projects Batch Routes
 *
 * POST /api/users/projects
 * Accepts JSON: {
 *   userIds: string[],
 *   organization_id?: string,
 *   tenant_id?: string,
 *   from?: string|Date,
 *   to?: string|Date
 * }
 *
 * Returns a map keyed by userId. Each value is an object compatible with the frontend expectations:
 *   {
 *     total_count: number,
 *     projects: Array<{ project_id, project_name, last_activity }>
 *   }
 *
 * Notes:
 * - Supports very large userIds arrays safely by chunking; overall cap is configurable.
 * - organization_id and tenant_id are aliases; organization_id takes precedence.
 * - Super Admin / wildcard tenant:
 *    - organization_id === 'T0000' (case-insensitive) is treated as "all tenants" (no tenant/org filter).
 *    - Additionally, if no tenant is provided but caller sets x-organization-id: T0000, it is accepted.
 * - Uses MongoDB aggregation with allowDiskUse to avoid memory pressure.
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const cors = require('cors');
const { getDb } = require('../config/db'); // existing db helper if available

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

// Simple logger
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
    map[uid] = { total_count: 0, projects: [] };
  }
  return map;
}

/**
 * Run aggregation for a single chunk of userIds and return results shaped as:
 *   [{ user_id, projects: [...] }]
 */
async function aggregateChunk({ db, userIdsChunk, tenant, isAllTenants, fromDate, toDate }) {
  const usersClause = { $expr: { $in: [{ $toString: '$user_id' }, userIdsChunk] } };

  const timeRange = {};
  if (fromDate) timeRange.$gte = fromDate;
  if (toDate) timeRange.$lte = toDate;

  const andClauses = [usersClause];

  if (!isAllTenants) {
    andClauses.push({ $or: [{ tenant_id: tenant }, { organization_id: tenant }] });
  }

  if (Object.keys(timeRange).length) {
    andClauses.push({
      $or: [{ last_updated: timeRange }, { session_start: timeRange }],
    });
  }

  const match = andClauses.length === 1 ? andClauses[0] : { $and: andClauses };

  // Aggregation pipeline
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
    { $project: { _id: 0, user_id: '$_id', projects: 1 } },
  ];

  const coll = db.collection('session_tracking');
  return coll.aggregate(pipeline, { allowDiskUse: true }).toArray();
}

// Route: POST /api/users/projects
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

    // Validation: userIds array
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

    // Parse dates (optional)
    const fromDate = parseDateSafe(from);
    const toDate = parseDateSafe(to);
    if ((from && !fromDate) || (to && !toDate)) {
      return res.status(400).json({ error: 'Invalid from/to date value(s)' });
    }

    // Very large userIds support:
    // - cap to prevent abuse (configurable)
    // - chunk to keep $in arrays manageable and avoid max BSON size issues
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

    // Collect results across chunks
    const merged = new Map(); // user_id -> array(project)
    for (const chunk of chunks) {
      // eslint-disable-next-line no-await-in-loop
      const results = await aggregateChunk({
        db,
        userIdsChunk: chunk,
        tenant,
        isAllTenants,
        fromDate,
        toDate,
      });

      for (const row of results || []) {
        if (!row || !row.user_id) continue;
        const uid = normalizeStringId(row.user_id);
        const existing = merged.get(uid) || [];
        const incoming = (row.projects || []).map((p) => ({
          project_id: normalizeStringId(p.project_id),
          project_name: p.project_name || null,
          last_activity: p.last_activity ? new Date(p.last_activity) : null,
        }));
        merged.set(uid, existing.concat(incoming));
      }
    }

    // Initialize all keys with empty objects to handle empty results gracefully
    const data = buildEmptyResponseMap(userIds);

    // Fill data from merged map; de-dupe projects by project_id with max(last_activity)
    for (const [uid, projects] of merged.entries()) {
      const byProject = new Map(); // project_id -> project
      for (const p of projects) {
        if (!p?.project_id) continue;
        const prev = byProject.get(p.project_id);
        const prevTime = prev?.last_activity ? new Date(prev.last_activity).getTime() : -Infinity;
        const nextTime = p.last_activity ? new Date(p.last_activity).getTime() : -Infinity;

        if (!prev || nextTime > prevTime) {
          byProject.set(p.project_id, p);
        }
      }

      const deduped = Array.from(byProject.values()).sort((a, b) => {
        const at = a.last_activity ? new Date(a.last_activity).getTime() : 0;
        const bt = b.last_activity ? new Date(b.last_activity).getTime() : 0;
        return bt - at;
      });

      data[uid] = {
        total_count: deduped.length,
        projects: deduped,
      };
    }

    log('batch projects ok', {
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

    // Ensure we send a JSON error even if default errorHandler changes
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      requestId,
    });
  }
});

module.exports = router;
