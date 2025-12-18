'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');

/**
 * PUBLIC_INTERFACE
 * GET /api/metrics/users
 * Returns user metrics counts:
 *  - totalUsers: total DISTINCT users in scope
 *  - activeUsers: DISTINCT users with status 'active'
 *
 * Tenant scoping rules:
 *  - If organization_id (or tenant_id) = 'T0000' then return counts across ALL tenants.
 *  - Otherwise, return counts only within the resolved tenant.
 */
router.get('/', verifyAuth, requireTenant, async (req, res, next) => {
  try {
    // Support both organization_id and tenant_id as inputs (headers take precedence)
    const headerOrg = (req.headers?.['x-organization-id'] || req.headers?.['x-tenant-id'] || '').toString().trim();
    const queryOrg = (req.query?.organization_id || '').toString().trim();
    const queryTid = (req.query?.tenant_id || '').toString().trim();
    const authTenant = (req.auth?.tenantId || '').toString().trim();

    // Effective requested org (used only to detect T0000)
    const requestedOrg = headerOrg || queryOrg || queryTid || authTenant;

    // Super-admin override
    const isAllTenantsBypass =
      requestedOrg && String(requestedOrg).toUpperCase() === 'T0000';

    // Resolve effective tenant
    const effectiveTenant = isAllTenantsBypass
      ? undefined
      : (req.tenantId || authTenant || headerOrg || queryOrg || queryTid || '').toString().trim();

    if (!isAllTenantsBypass && !effectiveTenant) {
      return res.status(400).json({
        success: false,
        message: 'organization_id (tenant) is required unless using T0000 super-admin override',
      });
    }

    const dbo = await getDb();
    const usersCol = dbo.collection('users');

    // Tenant filter
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

    // Active status filter (strict)
    const statusActiveExpr = {
      $or: [
        { status: { $in: ['active', 'ACTIVE', 'Active'] } },
        { 'profile.status': { $in: ['active', 'ACTIVE', 'Active'] } },
        { 'status.value': { $in: ['active', 'ACTIVE', 'Active'] } },
      ],
    };

    /**
     * IMPORTANT:
     * We count DISTINCT users, not documents.
     * `_id` is assumed to be the unique user identifier.
     * Change this to `email`, `user_id`, etc. if needed.
     */
    const USER_ID_FIELD = '_id';

    const baseMatchStage = isAllTenantsBypass
      ? []
      : [{ $match: tenantFilter }];

    const totalUsersPipeline = [
      ...baseMatchStage,
      { $group: { _id: `$${USER_ID_FIELD}` } },
      { $count: 'count' },
    ];

    const activeUsersPipeline = [
      ...baseMatchStage,
      { $match: statusActiveExpr },
      { $group: { _id: `$${USER_ID_FIELD}` } },
      { $count: 'count' },
    ];

    const [totalAgg, activeAgg] = await Promise.all([
      usersCol.aggregate(totalUsersPipeline).toArray(),
      usersCol.aggregate(activeUsersPipeline).toArray(),
    ]);

    const totalUsers = totalAgg[0]?.count || 0;
    const activeUsers = activeAgg[0]?.count || 0;

    // Diagnostics headers
    try {
      res.set('X-Users-Tenant-Mode', isAllTenantsBypass ? 'all-tenants' : 'scoped');
      res.set('X-Effective-Tenant', isAllTenantsBypass ? 'T0000' : String(effectiveTenant));
      res.set('X-Users-Count-Mode', 'distinct');
    } catch {}

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
