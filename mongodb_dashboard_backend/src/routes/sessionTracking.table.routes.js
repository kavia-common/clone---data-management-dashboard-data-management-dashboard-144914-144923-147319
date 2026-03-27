'use strict';

const express = require('express');
const mongoose = require('mongoose');

const SessionTracking = require('../models/sessionTracking.model');
const User = require('../models/user.model');

const router = express.Router();

// Defaults aligned with UI + tests
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
 * The backend supports multiple auth/tenant middleware stacks, so we check common locations.
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
 * Special case: tenantId === 'T0000' means "all tenants" (bypass scoping) in this codebase/tests.
 */
function buildTenantScopeFilter(tenantId) {
  if (!tenantId) return null;
  if (tenantId === 'T0000') return null;

  return {
    $or: [{ tenant_id: tenantId }, { organization_id: tenantId }, { organizationId: tenantId }],
  };
}

function buildDateRangeFilter(req) {
  // When both start/end and from/to are provided, start/end wins.
  const rawStart = req.query.start ?? req.query.from;
  const rawEnd = req.query.end ?? req.query.to;

  let start = rawStart ? new Date(String(rawStart)) : null;
  let end = rawEnd ? new Date(String(rawEnd)) : null;

  const hasValidStart = start && !Number.isNaN(start.getTime());
  const hasValidEnd = end && !Number.isNaN(end.getTime());

  if (hasValidEnd) {
    // Inclusive end-of-day (UTC) behavior
    end = new Date(end);
    end.setUTCHours(23, 59, 59, 999);
  }

  if (hasValidStart || hasValidEnd) {
    const cond = {};
    if (hasValidStart) cond.$gte = start;
    if (hasValidEnd) cond.$lte = end;
    return { session_start: cond };
  }

  // Default window: last N days, applied to session_start
  const now = new Date();
  const windowStart = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { session_start: { $gte: windowStart, $lte: now } };
}

function buildUserEmailFilter(req) {
  const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
  const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';
  const parts = [];

  if (userId) {
    // Type-safe matching even when Mongo stored mixed types
    parts.push({ $expr: { $eq: [{ $toString: '$user_id' }, String(userId)] } });
  }

  if (email) {
    // Match either user_email or email fields
    parts.push({ $or: [{ user_email: email }, { email }] });
  }

  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : { $and: parts };
}

async function resolveUserIdsByName(q) {
  const name = normalizeWhitespace(q);
  if (!name) return [];

  const spaceTolerant = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const rx = new RegExp(spaceTolerant, 'i');

  const users = await User.find({
    $or: [{ user_name: rx }, { User_name: rx }, { name: rx }, { full_name: rx }, { fullName: rx }],
  })
    .sort({ _id: 1 })
    .lean();

  const ids = [];
  for (const u of users || []) {
    const id = u?.user_id ?? u?._id;
    if (id == null) continue;
    ids.push(String(id));
  }

  return [...new Set(ids)];
}

/**
 * Build the canonical DB filter for the table endpoint.
 * This is the single source of truth used for BOTH:
 * - SessionTracking.find(dbFilter)
 * - SessionTracking.countDocuments(dbFilter)
 *
 * Invariant: rows returned are EXACTLY those matching meta.total.
 */
async function buildTableDbFilter(req) {
  const tenantId = resolveTenantId(req);
  const tenantFilter = buildTenantScopeFilter(tenantId);

  const dateFilter = buildDateRangeFilter(req);
  const userEmailFilter = buildUserEmailFilter(req);

  const q = typeof req.query.q === 'string' ? normalizeWhitespace(req.query.q) : '';
  let qResolvedUserIds = [];
  let qFilter = null;

  if (q) {
    // Prefer q -> userId(s) resolution first.
    qResolvedUserIds = await resolveUserIdsByName(q);

    if (qResolvedUserIds.length) {
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

  const parts = [];
  if (tenantFilter) parts.push(tenantFilter);
  if (dateFilter) parts.push(dateFilter);
  if (userEmailFilter) parts.push(userEmailFilter);
  if (qFilter) parts.push(qFilter);

  const dbFilter = parts.length === 0 ? {} : parts.length === 1 ? parts[0] : { $and: parts };
  return { dbFilter, qResolvedUserIds, q };
}

// PUBLIC_INTERFACE
router.get('/', async (req, res) => {
  /** Session table endpoint: exact DB-filtered rows + meta.total aligned with the same filter. */
  try {
    const page = parsePositiveInt(req.query.page, DEFAULT_PAGE);
    const limit = Math.min(parsePositiveInt(req.query.limit ?? req.query.pageSize, DEFAULT_LIMIT), MAX_LIMIT);
    const skip = (page - 1) * limit;

    // In dev/test, server may start without DB - return predictable empty envelope.
    if (!isDbConnected()) {
      return res.status(200).json({ success: true, data: [], meta: { page, limit, total: 0 } });
    }

    const sort = typeof req.query.sort === 'string' && req.query.sort.trim() ? req.query.sort.trim() : '-session_start';

    const { dbFilter, qResolvedUserIds, q } = await buildTableDbFilter(req);

    // Execute using the same dbFilter for find + total (critical invariant)
    const docsPromise = SessionTracking.find(dbFilter).sort(sort).skip(skip).limit(limit).lean();
    const totalPromise = SessionTracking.countDocuments(dbFilter);
    const [docs, total] = await Promise.all([docsPromise, totalPromise]);

    if (q && qResolvedUserIds.length) {
      // Debug headers for frontend/test diagnostics
      res.set('x-sessiontracking-q-resolved-userids', qResolvedUserIds.join(','));
      res.set('x-sessiontracking-q-resolved-userid', qResolvedUserIds[0]);
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
    return res.status(500).json({
      success: false,
      message: 'Failed to list session tracking table rows',
      error: err?.message || String(err),
    });
  }
});

module.exports = router;
