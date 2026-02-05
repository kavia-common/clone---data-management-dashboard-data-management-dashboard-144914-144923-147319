'use strict';

const express = require('express');
const router = express.Router();

const { getDb, isDbConnected } = require('../config/db');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');

/**
 * PUBLIC_INTERFACE
 * GET /api/metrics/users
 *
 * Returns user metrics:
 *  - totalUsers: DISTINCT users in scope
 *  - activeUsers: DISTINCT active users in scope
 *
 * Tenant rules:
 *  - T0000 is allowed ONLY for super-admins → all tenants
 *  - Otherwise scoped to resolved tenant
 */
router.get('/', verifyAuth, requireTenant, async (req, res, next) => {
  try {
    /* ------------------------------------------------------------------
     * 1️⃣ HARD STOP if DB is not connected
     * ------------------------------------------------------------------ */
    if (!isDbConnected()) {
      return res.status(503).json({
        success: false,
        error: 'Database not connected',
        code: 'DB_DISCONNECTED',
      });
    }

    /* ------------------------------------------------------------------
     * 2️⃣ Resolve tenant inputs
     * ------------------------------------------------------------------ */
    const headerOrg =
      (req.headers?.['x-organization-id'] ||
        req.headers?.['x-tenant-id'] ||
        '')
        .toString()
        .trim();

    const queryOrg = (req.query?.organization_id || '').toString().trim();
    const queryTid = (req.query?.tenant_id || '').toString().trim();
    const authTenant = (req.auth?.tenantId || '').toString().trim();

    const requestedOrg =
      headerOrg || queryOrg || queryTid || authTenant;

    /* ------------------------------------------------------------------
     * 3️⃣ Secure T0000 super-admin bypass
     * ------------------------------------------------------------------ */
    const isSuperAdmin =
      Array.isArray(req.auth?.roles) &&
      req.auth.roles.includes('SUPER_ADMIN');

    const isAllTenantsBypass =
      isSuperAdmin &&
      requestedOrg &&
      requestedOrg.toUpperCase() === 'T0000';

    const effectiveTenant = isAllTenantsBypass
      ? null
      : (req.tenantId ||
          authTenant ||
          headerOrg ||
          queryOrg ||
          queryTid ||
          '')
          .toString()
          .trim();

    if (!isAllTenantsBypass && !effectiveTenant) {
      return res.status(400).json({
        success: false,
        message:
          'organization_id (tenant) is required unless using T0000 with super-admin role',
      });
    }

    /* ------------------------------------------------------------------
     * 4️⃣ Mongo access (safe)
     * ------------------------------------------------------------------ */
    const db = await getDb();

    if (!db) {
      return res.status(503).json({
        success: false,
        error: 'Database unavailable',
        code: 'DB_UNAVAILABLE',
      });
    }

    const usersCol = db.collection('users');

    /* ------------------------------------------------------------------
     * 5️⃣ Query filters
     * ------------------------------------------------------------------ */
    const tenantFilter = isAllTenantsBypass
      ? {}
      : {
          $or: [
            { tenant_id: effectiveTenant },
            { organization_id: effectiveTenant },
            { organizationId: effectiveTenant },
            { tenantId: effectiveTenant },
            { orgId: effectiveTenant },
            { 'tenant.tenant_id': effectiveTenant },
          ],
        };

    const activeStatusFilter = {
      $or: [
        { status: { $in: ['active', 'ACTIVE', 'Active'] } },
        { 'profile.status': { $in: ['active', 'ACTIVE', 'Active'] } },
        { 'status.value': { $in: ['active', 'ACTIVE', 'Active'] } },
      ],
    };

    /* ------------------------------------------------------------------
     * 6️⃣ Aggregation pipelines
     * ------------------------------------------------------------------ */
    const USER_ID_FIELD = '_id';

    const baseMatch = isAllTenantsBypass
      ? []
      : [{ $match: tenantFilter }];

    const totalUsersPipeline = [
      ...baseMatch,
      { $group: { _id: `$${USER_ID_FIELD}` } },
      { $count: 'count' },
    ];

    const activeUsersPipeline = [
      ...baseMatch,
      { $match: activeStatusFilter },
      { $group: { _id: `$${USER_ID_FIELD}` } },
      { $count: 'count' },
    ];

    const [totalAgg, activeAgg] = await Promise.all([
      usersCol.aggregate(totalUsersPipeline).toArray(),
      usersCol.aggregate(activeUsersPipeline).toArray(),
    ]);

    const totalUsers = totalAgg[0]?.count || 0;
    const activeUsers = activeAgg[0]?.count || 0;

    /* ------------------------------------------------------------------
     * 7️⃣ Diagnostics headers
     * ------------------------------------------------------------------ */
    try {
      res.set(
        'X-Users-Tenant-Mode',
        isAllTenantsBypass ? 'all-tenants' : 'scoped'
      );
      res.set(
        'X-Effective-Tenant',
        isAllTenantsBypass ? 'T0000' : effectiveTenant
      );
      res.set('X-Users-Count-Mode', 'distinct');
    } catch {
      // ignore header failures
    }

    /* ------------------------------------------------------------------
     * 8️⃣ Response
     * ------------------------------------------------------------------ */
    return res.status(200).json({
      success: true,
      totalUsers,
      activeUsers,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
