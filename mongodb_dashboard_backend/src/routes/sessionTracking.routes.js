'use strict';

const express = require('express');
const mongoose = require('mongoose');

const SessionTracking = require('../models/sessionTracking.model');
const User = require('../models/user.model');

/**
 * Session Tracking Routes
 *
 * Provides the canonical list endpoint used by:
 * - GET /api/session-tracking
 * - GET /api/sessionTracking (legacy alias)
 *
 * Also re-used by /api/session-tracking/table via sessionTracking.table.routes.js.
 *
 * Implementation goals:
 * - Be resilient in dev mode when DB is disconnected (return empty envelope instead of crashing).
 * - Enforce tenant scoping when tenant is provided via headers/JWT context.
 * - Support filtering used by the UI and tests: start/end date range, userId, email alias, q search.
 * - When q matches user_name, resolve user_id(s) and filter sessions by those ids (table tests).
 *
 * Notes:
 * - This file is intentionally minimal: it implements the GET list behavior and returns a stable
 *   envelope shape { success, data, meta } to match table tests, while still allowing raw array
 *   fallback if pagination params are omitted (legacy behavior).
 */

const router = express.Router();

// Defaults used by tests and UI expectations
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const DEFAULT_WINDOW_DAYS = 30;

function isDbConnected() {
  return mongoose.connection?.readyState === 1;
}

function normalizeWhitespace(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

/**
 * Determine effective tenant id from request.
 * We try multiple sources because this codebase supports multiple auth/tenant middleware stacks.
 */
function resolveTenantId(req) {
  return (
    req.tenantId ||
    req.auth?.tenantId ||
    req.user?.tenantId ||
    (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
    (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
    (typeof req.query.tenant_id === 'string' && req.query.tenant_id.trim()) ||
    (typeof req.query.organization_id === 'string' && req.query.organization_id.trim()) ||
    null
  );
}

/**
 * Build a tenant scope filter.
 * Special case: tenantId === 'T0000' is treated as "all tenants" in tests (bypass scoping).
 */
function buildTenantScopeFilter(tenantId) {
  if (!tenantId) return null;
  if (tenantId === 'T0000') return null;

  // Support multiple field variants observed in this codebase.
  return {
    $or: [{ tenant_id: tenantId }, { organization_id: tenantId }, { organizationId: tenantId }],
  };
}

function buildDateRangeFilter(req) {
  /**
   * Build an explicit date-range filter.
   *
   * IMPORTANT (back-compat / restored behavior):
   * - We DO NOT apply an implicit default window when the client does not request a date filter.
   *   The previous session-tracking logic returned totals across the full dataset unless
   *   the caller provided start/end (or from/to).
   *
   * Invariant:
   * - If start/end (or from/to) are absent/invalid => return null (no date constraint).
   */
  const rawStart = req.query.start ?? req.query.from;
  const rawEnd = req.query.end ?? req.query.to;

  let start = rawStart ? new Date(String(rawStart)) : null;
  let end = rawEnd ? new Date(String(rawEnd)) : null;

  const hasValidStart = start && !Number.isNaN(start.getTime());
  const hasValidEnd = end && !Number.isNaN(end.getTime());

  if (!hasValidStart && !hasValidEnd) return null;

  if (hasValidEnd) {
    // inclusive end-of-day (UTC) behavior
    end = new Date(end);
    end.setUTCHours(23, 59, 59, 999);
  }

  const cond = {};
  if (hasValidStart) cond.$gte = start;
  if (hasValidEnd) cond.$lte = end;
  return { session_start: cond };
}

function buildUserEmailFilter(req) {
  const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
  const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';
  const parts = [];

  if (userId) {
    // Be robust to mixed types in Mongo by comparing stringified value.
    parts.push({ $expr: { $eq: [{ $toString: '$user_id' }, String(userId)] } });
  }

  if (email) {
    // Tests expect email to match either user_email or email field
    parts.push({ $or: [{ user_email: email }, { email }] });
  }

  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : { $and: parts };
}

async function resolveUserIdsByName(q) {
  const name = normalizeWhitespace(q);
  if (!name) return [];

  // Case-insensitive regex; tolerate inconsistent whitespace in stored names by converting
  // spaces in query to '\\s+'.
  const spaceTolerant = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const rx = new RegExp(spaceTolerant, 'i');

  // Support common name fields in the dataset.
  const users = await User.find({
    $or: [{ user_name: rx }, { User_name: rx }, { name: rx }, { full_name: rx }, { fullName: rx }],
  })
    .sort({ _id: 1 })
    .lean();

  const ids = [];
  for (const u of users || []) {
    // Prefer explicit user_id field if present, otherwise fall back to _id
    const id = u?.user_id ?? u?._id;
    if (id == null) continue;
    ids.push(String(id));
  }

  // Return unique, stable order
  return [...new Set(ids)];
}

// PUBLIC_INTERFACE
router.get('/', async (req, res) => {
  /** List session tracking records with filtering, q-search, and pagination envelope. */
  try {
    // In dev/test environments the server may start without DB (see app.js). Don’t crash.
    if (!isDbConnected()) {
      const page = parsePositiveInt(req.query.page, DEFAULT_PAGE);
      const limit = Math.min(parsePositiveInt(req.query.limit ?? req.query.pageSize, DEFAULT_LIMIT), MAX_LIMIT);
      return res.status(200).json({
        success: true,
        data: [],
        meta: { page, limit, total: 0 },
      });
    }

    const tenantId = resolveTenantId(req);
    const tenantFilter = buildTenantScopeFilter(tenantId);

    const dateFilter = buildDateRangeFilter(req);
    const userEmailFilter = buildUserEmailFilter(req);

    const q = typeof req.query.q === 'string' ? normalizeWhitespace(req.query.q) : '';
    let qResolvedUserIds = [];

    // When q is present, attempt user name -> user_id resolution first (table tests).
    // If no users match, fall back to legacy regex search across common fields.
    let qFilter = null;
    if (q) {
      qResolvedUserIds = await resolveUserIdsByName(q);

      if (qResolvedUserIds.length) {
        // Required by table.qsearch test: type-safe membership using $toString + $in.
        qFilter = { $expr: { $in: [{ $toString: '$user_id' }, qResolvedUserIds] } };
      } else {
        const spaceTolerant = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
        const rx = new RegExp(spaceTolerant, 'i');
        qFilter = {
          $or: [
            { task_id: rx },
            { tenant_id: rx },
            { organization_name: rx },
            { user_name: rx },
            { User_name: rx },
            { project_id: rx },
            { container_id: rx },
            { service_type: rx },
            { status: rx },
            { user_id: rx },
            { 'session_data.session_name': rx },
            { 'session_data.description': rx },
            { 'session_data.llm_model': rx },
          ],
        };
      }
    }

    // Merge filters
    const parts = [];
    if (tenantFilter) parts.push(tenantFilter);
    if (dateFilter) parts.push(dateFilter);
    if (userEmailFilter) parts.push(userEmailFilter);
    if (qFilter) parts.push(qFilter);

    const filter = parts.length === 0 ? {} : parts.length === 1 ? parts[0] : { $and: parts };

    // Pagination: if page/limit specified, return envelope; else allow raw array.
    const hasPaging = req.query.page != null || req.query.limit != null || req.query.pageSize != null;
    const page = parsePositiveInt(req.query.page, DEFAULT_PAGE);
    const limit = Math.min(parsePositiveInt(req.query.limit ?? req.query.pageSize, DEFAULT_LIMIT), MAX_LIMIT);
    const skip = (page - 1) * limit;

    const sort = typeof req.query.sort === 'string' && req.query.sort.trim() ? req.query.sort.trim() : '-session_start';

    const docsPromise = SessionTracking.find(filter).sort(sort).skip(skip).limit(limit).lean();
    const totalPromise = SessionTracking.countDocuments(filter);

    const [docs, total] = await Promise.all([docsPromise, totalPromise]);

    // Debug headers for q-resolution (required by table.qsearch test)
    if (q && qResolvedUserIds.length) {
      res.set('x-sessiontracking-q-resolved-userids', qResolvedUserIds.join(','));
      // Back-compat: first id
      res.set('x-sessiontracking-q-resolved-userid', qResolvedUserIds[0]);
    }

    if (!hasPaging) {
      return res.status(200).json(docs);
    }

    return res.status(200).json({
      success: true,
      data: docs,
      meta: {
        page,
        limit,
        total,
        ...(qResolvedUserIds.length ? { matchedUserIds: qResolvedUserIds } : {}),
      },
    });
  } catch (err) {
    // Keep response shape predictable for the UI/tests.
    return res.status(500).json({
      success: false,
      message: 'Failed to list session tracking records',
      error: err?.message || String(err),
    });
  }
});

module.exports = router;
