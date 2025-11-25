'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { attachAuthContext, requireAuth } = require('../middleware/auth');
const AuditLog = require('../models/auditLog.model');
const { userHasTenant, normalizeUserTenants, isSuperAdminUser } = require('../utils/rbac');
const { isSuperAdmin, normalizeTenantId } = require('../utils/access');

const router = express.Router();

/**
 * Note: These routes are mounted behind verifyAuth + requireTenant in app.js.
 * We still attach additional auth context for legacy routes as needed.
 */
router.use(attachAuthContext());

/**
 * @swagger
 * /api/session/tenants:
 *   get:
 *     summary: List authorized tenants for current user
 *     description: Returns the list of tenants from the authenticated user's record (users.tenants). Requires Authorization header.
 *     tags: [Auth, Tenants]
 *     responses:
 *       200:
 *         description: Authorized tenants for the user
 *       401:
 *         description: Unauthorized
 */
// PUBLIC_INTERFACE
router.get(
  '/tenants',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const user = req.user;

    // Super Admin: may request any tenant; for now we return user's tenants list
    // TODO: If needed, populate with all tenants from DB for Super Admins.
    const items = normalizeUserTenants(user);

    // GxP audit: READ tenant listing
    await AuditLog.create({
      action: 'READ',
      resource: 'session.tenants',
      path: req.originalUrl,
      method: req.method,
      user_id: user?.id || null,
      ip: req.ip,
      user_agent: req.headers['user-agent'] || '',
      before: null,
      after: { count: items.length },
      outcome: 'SUCCESS',
      trace_id: req.traceId || null,
    });

    return res.status(200).json({ success: true, items, total: items.length });
  })
);

/**
 * @swagger
 * /api/session/tenant:
 *   post:
 *     summary: Set active tenant for current session
 *     description: >
 *       Sets the active tenant in the session/token context. Validates RBAC: the user must belong to the tenant.
 *       Returns confirmation.
 *     tags:
 *       - Auth
 *       - Tenants
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tenantId:
 *                 type: string
 *                 description: Tenant identifier to set as active
 *               reason:
 *                 type: string
 *                 description: Optional reason for change for audit trail
 *             required:
 *               - tenantId
 *     responses:
 *       200:
 *         description: Active tenant set
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not member of tenant)
 */
/**
 * @swagger
 * /api/tenants/select:
 *   post:
 *     summary: Select active tenant for current session
 *     description: >
 *       Validates user access to tenantId, records audit trail, and persists selection in cookie.
 *       Alias of /api/session/tenant.
 *     tags:
 *       - Auth
 *       - Tenants
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tenantId:
 *                 type: string
 *                 description: Tenant identifier to set as active
 *               reason:
 *                 type: string
 *                 description: Optional reason for change for audit trail
 *             required:
 *               - tenantId
 *     responses:
 *       200:
 *         description: Active tenant set
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not member of tenant)
 */
// PUBLIC_INTERFACE
router.post(
  '/tenant',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const { tenantId, reason } = req.body || {};
    const user = req.user;

    // Validate input
    if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'tenantId is required and must be a non-empty string',
      });
    }

    // RBAC: ensure user has this tenant; Super Admin bypasses
    const nTenant = normalizeTenantId(tenantId);
    const allowed = isSuperAdminUser(user) || userHasTenant(user, nTenant);
    const beforeState = { activeTenant: req.activeTenant || null };

    if (!allowed) {
      // GxP audit: UPDATE attempt denied
      await AuditLog.create({
        action: 'UPDATE',
        resource: 'session.tenant',
        path: req.originalUrl,
        method: req.method,
        user_id: user?.id || null,
        ip: req.ip,
        user_agent: req.headers['user-agent'] || '',
        reason: reason || null,
        before: beforeState,
        after: { activeTenant: tenantId },
        outcome: 'FAILURE',
        trace_id: req.traceId || null,
      });
      return res.status(403).json({
        success: false,
        message: 'You do not have access to the requested tenant',
      });
    }

    // Set active tenant cookie (non-HTTPOnly so frontend can also read; set Secure if https)
    const cookieOptions = {
      httpOnly: false,
      sameSite: 'Lax',
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    };
    try {
      res.cookie('activeTenant', tenantId, cookieOptions);
    } catch {
      // If cookies aren't configured, ignore; frontend persists locally
    }

    // GxP audit: UPDATE success
    await AuditLog.create({
      action: 'UPDATE',
      resource: 'session.tenant',
      path: req.originalUrl,
      method: req.method,
      user_id: user?.id || null,
      ip: req.ip,
      user_agent: req.headers['user-agent'] || '',
      reason: reason || null,
      before: beforeState,
      after: { activeTenant: tenantId },
      outcome: 'SUCCESS',
      trace_id: req.traceId || null,
    });

    if (isSuperAdmin(req)) {
      try {
        res.set('X-Applied-Tenant', String(nTenant));
        res.set('X-Applied-Filter', JSON.stringify({ $match: `tenant ${nTenant} (super-admin selected)` }));
      } catch {}
    }

    const payload = {
      success: true,
      message: 'Active tenant set',
      activeTenant: tenantId,
    };
    return res.status(200).json(payload);
  })
);

// PUBLIC_INTERFACE
// Alias route mounted at /api/tenants/select via app.use('/api/session', router)
router.post(
  '/tenants/select',
  requireAuth(),
  asyncHandler(async (req, res, next) => {
    // Reuse same handler by rewriting path to /tenant
    req.url = '/tenant';
    return router.handle(req, res, next);
  })
);

/**
 * PUBLIC_INTERFACE
 * POST /api/session/all-tenants
 * Toggle Super Admin global mode so backend skips tenant filters for the session/request context.
 * Body: { enabled: true|false }
 * Notes:
 *  - Only Super Admin can enable this; non-super admins get 403.
 *  - For stateless tokens, this acts per-request and returns headers clients can persist and send on subsequent calls.
 */
router.post(
  '/all-tenants',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const enabled = String((req.body?.enabled ?? '')).toLowerCase();
    const val = enabled === 'true' || enabled === '1' || enabled === 'yes' || enabled === 'on';

    if (!isSuperAdmin(req)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Only Super Admin can toggle all-tenants' });
    }

    // Set flags for this request; clients should persist via header X-All-Tenants on future requests
    req.tenantScopeDisabled = !!val;
    req.allTenants = !!val;
    if (req.user) { req.user.allTenants = !!val; }

    try {
      res.set('X-All-Tenants', val ? 'true' : 'false');
      res.set('X-Applied-Tenant', val ? 'all-tenants' : (req.tenantId ? String(req.tenantId) : 'unset'));
    } catch {}

    // Audit (best-effort)
    await AuditLog.create({
      action: 'UPDATE',
      resource: 'session.all-tenants',
      path: req.originalUrl,
      method: req.method,
      user_id: req.user?.id || null,
      ip: req.ip,
      user_agent: req.headers['user-agent'] || '',
      before: { enabled: !val },
      after: { enabled: val },
      outcome: 'SUCCESS',
      trace_id: req.traceId || null,
    }).catch(() => {});

    return res.status(200).json({ success: true, enabled: val });
  })
);

module.exports = router;
