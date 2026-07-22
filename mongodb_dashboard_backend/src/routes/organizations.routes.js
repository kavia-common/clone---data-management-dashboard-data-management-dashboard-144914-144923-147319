'use strict';

/**
 * PUBLIC_INTERFACE
 * organizations.routes.js
 *
 * Express router for the Organization feature.
 * Mounted at /api/organizations in app.js.
 *
 * Endpoints:
 *   GET /api/organizations/tenants
 *     Returns the tenant scope available to the caller for the multi-tenant dropdown.
 *
 *   GET /api/organizations/users
 *     Query params:
 *       from          string  optional  YYYY-MM-DD | ISO-8601 (defaults to today UTC)
 *       to            string  optional  YYYY-MM-DD | ISO-8601 (defaults to today UTC)
 *       tenant_ids    string  optional  comma-separated tenant_id list (domain-admin only)
 *       all_tenants   string  optional  "true" to merge across every tenant in the
 *                                       caller's managed domain (domain-admin only)
 *
 *   GET /api/organizations/users/:userId/sessions
 *     Per-session breakdown (project_id, session_name, total_duration) for one user,
 *     fetched lazily on hover over that user's session count in the table. Accepts the
 *     same from/to/tenant_ids/all_tenants query params as GET /users so the detail
 *     honours whatever date range / tenant scope the table is currently showing.
 *
 * Auth / tenant handling:
 *   - Best-effort auth context (attachAuthContext), mirroring tata.sessions.routes.js.
 *   - Domain-admin bypass (hardcoded registry in config/domainAdmins.js) runs BEFORE
 *     requireTenant so a domain-admin tenant (e.g. T0038) can request a cross-tenant
 *     view. Every other tenant — including the 27 other tenants that happen to share
 *     the same email domain — is locked to its own tenant_id via requireTenant, and
 *     any client-supplied tenant_ids/all_tenants is ignored for them.
 *
 * Constraints:
 *   - All MongoDB operations are strictly read-only (no inserts/updates/deletes).
 */

const express = require('express');
const { requireTenant } = require('../middleware/requireTenant');
const { attachAuthContext } = require('../middleware/auth');
const { getManagedDomain } = require('../config/domainAdmins');
const {
  getTenantScopeForCaller,
  getOrganizationUsersTable,
  getPlatformUsageTable,
  getUserSessionDetails,
} = require('../services/organizations.service');

const router = express.Router();

// Best-effort auth context (does not hard-require Authorization header)
router.use(attachAuthContext());

/**
 * Resolve the caller's own tenant_id the same way requireTenant would (JWT > header > query),
 * without yet enforcing/locking it — needed so we can decide whether the domain-admin bypass
 * applies before requireTenant runs.
 */
function resolveCallerTenantId(req) {
  const jwtTenant = req?.auth?.tenantId;
  if (jwtTenant) return String(jwtTenant);

  const hdrTenant =
    (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
    (typeof req.headers['organization_id'] === 'string' && req.headers['organization_id'].trim()) ||
    (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
    (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
    '';
  if (hdrTenant) return hdrTenant;

  const qTenant =
    (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
    (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) ||
    '';
  return qTenant || '';
}

/**
 * Domain-admin bypass — must run BEFORE requireTenant.
 * When the caller's own tenant is a registered domain admin (config/domainAdmins.js),
 * mark the request as cross-tenant-eligible and skip the normal single-tenant lock.
 */
router.use((req, res, next) => {
  try {
    const callerTenantId = resolveCallerTenantId(req);
    const managedDomain = getManagedDomain(callerTenantId);

    if (managedDomain) {
      req.isDomainAdmin = true;
      req.callerTenantId = callerTenantId;
      req.managedDomain = managedDomain;
      try { res.set('X-Domain-Admin', 'true'); } catch (_) {}
      return next();
    }

    req.isDomainAdmin = false;
  } catch (_) {
    req.isDomainAdmin = false;
  }

  // Non-domain-admin path: enforce normal single-tenant scope.
  return requireTenant(req, res, next);
});

// ─── Date resolution (copied verbatim from tata.sessions.routes.js for consistent behaviour) ──

function unwrapInput(s) {
  if (s === undefined || s === null) return '';
  const str = String(s).trim();
  const isoDateWrapped = /^ISODate\((.*)\)$/i.exec(str);
  return isoDateWrapped && isoDateWrapped[1]
    ? isoDateWrapped[1].trim().replace(/^['"]|['"]$/g, '')
    : str;
}

function parseMaybeYmd(raw, mode) {
  const s = unwrapInput(raw);
  if (!s) return null;

  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (ymd) {
    const y = Number(ymd[1]);
    const m0 = Number(ymd[2]) - 1;
    const d = Number(ymd[3]);
    return mode === 'from'
      ? new Date(Date.UTC(y, m0, d, 0, 0, 0, 0))
      : new Date(Date.UTC(y, m0, d, 23, 59, 59, 999));
  }

  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function resolveUtcWindow(fromRaw, toRaw) {
  const hasFrom = unwrapInput(fromRaw) !== '';
  const hasTo = unwrapInput(toRaw) !== '';

  if (!hasFrom && !hasTo) {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const d = now.getUTCDate();
    return {
      fromUtc: new Date(Date.UTC(y, m, d, 0, 0, 0, 0)),
      toUtc: new Date(Date.UTC(y, m, d, 23, 59, 59, 999)),
      appliedDefault: true,
    };
  }

  return {
    fromUtc: parseMaybeYmd(fromRaw, 'from'),
    toUtc: parseMaybeYmd(toRaw, 'to'),
    appliedDefault: false,
  };
}

// ─── GET /tenants ──────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/organizations/tenants:
 *   get:
 *     summary: Tenant scope available to the caller for the Organization dropdown
 *     tags: [Organizations]
 */
router.get('/tenants', async (req, res) => {
  try {
    const callerTenantId = req.isDomainAdmin ? req.callerTenantId : req.tenantId;
    if (!callerTenantId) {
      return res.status(400).json({ success: false, message: 'Missing tenant scope' });
    }

    const scope = await getTenantScopeForCaller(callerTenantId);
    return res.status(200).json({ success: true, ...scope });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[organizations.routes] GET /tenants error:', err?.message || err);
    if (err?.message === 'Database not connected') {
      return res.status(503).json({ success: false, message: 'Database not connected' });
    }
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ─── GET /users ─────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/organizations/users:
 *   get:
 *     summary: Unique-users-per-tenant table (name, email, organization, sessions, projects, code files, docs generated, credits)
 *     tags: [Organizations]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string }
 *       - in: query
 *         name: to
 *         schema: { type: string }
 *       - in: query
 *         name: tenant_ids
 *         schema: { type: string }
 *         description: Comma-separated tenant_id list (domain-admin only)
 *       - in: query
 *         name: all_tenants
 *         schema: { type: string }
 *         description: "true" to merge across every tenant in the caller's managed domain (domain-admin only)
 */
router.get('/users', async (req, res) => {
  try {
    const rawFrom = req.query?.from != null ? String(req.query.from) : null;
    const rawTo = req.query?.to != null ? String(req.query.to) : null;
    const echoFrom = rawFrom == null ? null : unwrapInput(rawFrom);
    const echoTo = rawTo == null ? null : unwrapInput(rawTo);

    const { fromUtc, toUtc, appliedDefault } = resolveUtcWindow(echoFrom, echoTo);
    if ((echoFrom && !fromUtc) || (echoTo && !toUtc)) {
      return res.status(400).json({ success: false, message: 'Invalid from/to date value(s)' });
    }

    const wantsAllTenants = String(req.query?.all_tenants || '').toLowerCase().trim() === 'true';
    const requestedTenantIdsRaw = String(req.query?.tenant_ids || '').trim();
    const requestedTenantIds = requestedTenantIdsRaw
      ? requestedTenantIdsRaw.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    let effectiveTenantIds;
    let mergeAcrossTenants;
    let isDomainAdmin = false;
    let managedDomain = null;

    if (req.isDomainAdmin) {
      isDomainAdmin = true;
      managedDomain = req.managedDomain;

      const scope = await getTenantScopeForCaller(req.callerTenantId);
      const allowedTenantIds = scope.tenants.map((t) => t.tenant_id);
      const allowedSet = new Set(allowedTenantIds);

      if (wantsAllTenants || requestedTenantIds.length === 0) {
        // Default for a domain admin with no explicit selection = "All Tenants" (merged).
        effectiveTenantIds = allowedTenantIds;
        mergeAcrossTenants = true;
      } else {
        // Explicit tenant(s) selected (one or multiple, but not "All"):
        // intersect with the allowed set to prevent scope escalation, then keep rows tenant-specific.
        effectiveTenantIds = requestedTenantIds.filter((t) => allowedSet.has(t));
        mergeAcrossTenants = false;
      }
    } else {
      // Non-domain-admin: strictly locked to the caller's own tenant (requireTenant already enforced this).
      effectiveTenantIds = [req.tenantId];
      mergeAcrossTenants = false;
    }

    const rows = await getOrganizationUsersTable({
      effectiveTenantIds,
      mergeAcrossTenants,
      fromUtc,
      toUtc,
    });

    try {
      res.set('X-Date-Window-Applied', appliedDefault ? 'default_today_utc' : 'explicit');
      if (fromUtc) res.set('X-Date-Window-From', fromUtc.toISOString());
      if (toUtc) res.set('X-Date-Window-To', toUtc.toISOString());
    } catch (_) {}

    return res.status(200).json({
      success: true,
      isDomainAdmin,
      managedDomain,
      appliedTenantIds: effectiveTenantIds,
      merged: mergeAcrossTenants,
      from: echoFrom,
      to: echoTo,
      rows,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[organizations.routes] GET /users error:', err?.message || err);
    if (err?.message === 'Database not connected') {
      return res.status(503).json({ success: false, message: 'Database not connected' });
    }
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ─── GET /platform-usage ───────────────────────────────────────────────────────

/**
 * @swagger
 * /api/organizations/platform-usage:
 *   get:
 *     summary: Platform usage grouped by user
 *     tags: [Organizations]
 *     parameters:
 *       - in: query
 *         name: execution_target
 *         schema: { type: string, enum: [local, cloud], default: local }
 *       - in: query
 *         name: from
 *         schema: { type: string }
 *       - in: query
 *         name: to
 *         schema: { type: string }
 *       - in: query
 *         name: tenant_ids
 *         schema: { type: string }
 *       - in: query
 *         name: all_tenants
 *         schema: { type: string }
 */
router.get('/platform-usage', async (req, res) => {
  try {
    const executionTarget = String(req.query?.execution_target || 'local').toLowerCase().trim();
    if (!['local', 'cloud'].includes(executionTarget)) {
      return res.status(400).json({
        success: false,
        message: 'execution_target must be either local or cloud',
      });
    }

    const rawFrom = req.query?.from !== null && req.query?.from !== undefined
      ? String(req.query.from)
      : null;
    const rawTo = req.query?.to !== null && req.query?.to !== undefined
      ? String(req.query.to)
      : null;
    const echoFrom = rawFrom === null ? null : unwrapInput(rawFrom);
    const echoTo = rawTo === null ? null : unwrapInput(rawTo);
    const { fromUtc, toUtc, appliedDefault } = resolveUtcWindow(echoFrom, echoTo);

    if ((echoFrom && !fromUtc) || (echoTo && !toUtc)) {
      return res.status(400).json({ success: false, message: 'Invalid from/to date value(s)' });
    }

    const wantsAllTenants = String(req.query?.all_tenants || '').toLowerCase().trim() === 'true';
    const requestedTenantIdsRaw = String(req.query?.tenant_ids || '').trim();
    const requestedTenantIds = requestedTenantIdsRaw
      ? requestedTenantIdsRaw.split(',').map((tenantId) => tenantId.trim()).filter(Boolean)
      : [];

    const sourceTenantId = req.isDomainAdmin ? req.callerTenantId : req.tenantId;
    let effectiveTenantIds;
    let mergeAcrossTenants;
    let isDomainAdmin = false;
    let managedDomain = null;

    if (req.isDomainAdmin) {
      isDomainAdmin = true;
      managedDomain = req.managedDomain;

      const scope = await getTenantScopeForCaller(req.callerTenantId);
      const allowedTenantIds = scope.tenants.map((tenant) => tenant.tenant_id);
      const allowedSet = new Set(allowedTenantIds);

      if (wantsAllTenants || requestedTenantIds.length === 0) {
        effectiveTenantIds = allowedTenantIds;
        mergeAcrossTenants = true;
      } else {
        effectiveTenantIds = requestedTenantIds.filter((tenantId) => allowedSet.has(tenantId));
        mergeAcrossTenants = false;
      }
    } else {
      effectiveTenantIds = [req.tenantId];
      mergeAcrossTenants = false;
    }

    const rows = await getPlatformUsageTable({
      sourceTenantId,
      effectiveTenantIds,
      mergeAcrossTenants,
      executionTarget,
      fromUtc,
      toUtc,
    });

    try {
      res.set('X-Date-Window-Applied', appliedDefault ? 'default_today_utc' : 'explicit');
      if (fromUtc) {
        res.set('X-Date-Window-From', fromUtc.toISOString());
      }
      if (toUtc) {
        res.set('X-Date-Window-To', toUtc.toISOString());
      }
    } catch {}

    return res.status(200).json({
      success: true,
      isDomainAdmin,
      managedDomain,
      appliedTenantIds: effectiveTenantIds,
      merged: mergeAcrossTenants,
      executionTarget,
      from: echoFrom,
      to: echoTo,
      rows,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[organizations.routes] GET /platform-usage error:', err?.message || err);
    if (err?.message === 'Database not connected') {
      return res.status(503).json({ success: false, message: 'Database not connected' });
    }
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ─── GET /users/:userId/sessions ────────────────────────────────────────────────

/**
 * @swagger
 * /api/organizations/users/{userId}/sessions:
 *   get:
 *     summary: Per-session breakdown for one user (project, session name, duration) — fetched lazily on hover
 *     tags: [Organizations]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         schema: { type: string }
 *       - in: query
 *         name: to
 *         schema: { type: string }
 *       - in: query
 *         name: tenant_ids
 *         schema: { type: string }
 *         description: Comma-separated tenant_id list (domain-admin only)
 *       - in: query
 *         name: all_tenants
 *         schema: { type: string }
 *         description: "true" to merge across every tenant in the caller's managed domain (domain-admin only)
 */
router.get('/users/:userId/sessions', async (req, res) => {
  try {
    const userId = String(req.params?.userId || '').trim();
    if (!userId) {
      return res.status(400).json({ success: false, message: 'Missing userId' });
    }

    const rawFrom = req.query?.from != null ? String(req.query.from) : null;
    const rawTo = req.query?.to != null ? String(req.query.to) : null;
    const echoFrom = rawFrom == null ? null : unwrapInput(rawFrom);
    const echoTo = rawTo == null ? null : unwrapInput(rawTo);

    const { fromUtc, toUtc } = resolveUtcWindow(echoFrom, echoTo);
    if ((echoFrom && !fromUtc) || (echoTo && !toUtc)) {
      return res.status(400).json({ success: false, message: 'Invalid from/to date value(s)' });
    }

    // Tenant-scope resolution mirrors GET /users exactly, duplicated here (rather than
    // shared) so the existing /users handler above is left completely untouched.
    const wantsAllTenants = String(req.query?.all_tenants || '').toLowerCase().trim() === 'true';
    const requestedTenantIdsRaw = String(req.query?.tenant_ids || '').trim();
    const requestedTenantIds = requestedTenantIdsRaw
      ? requestedTenantIdsRaw.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    let effectiveTenantIds;

    if (req.isDomainAdmin) {
      const scope = await getTenantScopeForCaller(req.callerTenantId);
      const allowedTenantIds = scope.tenants.map((t) => t.tenant_id);
      const allowedSet = new Set(allowedTenantIds);

      if (wantsAllTenants || requestedTenantIds.length === 0) {
        effectiveTenantIds = allowedTenantIds;
      } else {
        effectiveTenantIds = requestedTenantIds.filter((t) => allowedSet.has(t));
      }
    } else {
      // Non-domain-admin: strictly locked to the caller's own tenant. If userId belongs to
      // a different tenant, the aggregation's tenant_id filter simply yields zero rows.
      effectiveTenantIds = [req.tenantId];
    }

    const sessions = await getUserSessionDetails({
      userId,
      effectiveTenantIds,
      fromUtc,
      toUtc,
    });

    return res.status(200).json({ success: true, userId, sessions });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[organizations.routes] GET /users/:userId/sessions error:', err?.message || err);
    if (err?.message === 'Database not connected') {
      return res.status(503).json({ success: false, message: 'Database not connected' });
    }
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
