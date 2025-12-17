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
 *  - totalUsers: total number of user documents in scope
 *  - activeUsers: users considered active by status heuristics
 *
 * Tenant scoping:
 *  - By default, requires auth + tenant via verifyAuth + requireTenant.
 *  - If special tenant 'T0000' is provided via header x-organization-id or query (?tenant_id|organization_id),
 *    all-tenant bypass is applied (super-admin like) and scope is removed.
 *  - When Authorization is present, a conflicting tenant_id/organization_id is rejected by requireTenant middleware upstream.
 *
 * Active users heuristic (fallback if status missing -> 0 active):
 *  - status in ['active', 'ACTIVE', true, 1] or nested forms ('status.value', 'profile.status')
 */
router.get('/', verifyAuth, requireTenant, async (req, res, next) => {
  try {
    // Detect T0000 super-admin bypass (mirrors dashboard.routes behavior)
    let requestedTenant =
      (req.headers?.['x-organization-id'] || '').toString() ||
      (req.query?.organization_id || '').toString() ||
      (req.query?.tenant_id || '').toString() ||
      (req.auth?.tenantId || '').toString();

    const isAllTenantsBypass =
      requestedTenant && requestedTenant.toUpperCase() === 'T0000';

    const dbo = await getDb();
    const usersCol = dbo.collection('users');

    const tenantFilter = isAllTenantsBypass
      ? {}
      : {
          $or: [
            { tenant_id: req.tenantId },
            { organization_id: req.tenantId },
            { orgId: req.tenantId },
            { tenantId: req.tenantId },
            { organizationId: req.tenantId },
            { 'tenant.tenant_id': req.tenantId },
          ],
        };

    // Build active status filter; if status field is entirely missing in collection,
    // this filter will simply match none, giving activeUsers=0 (requested fallback).
    const statusActiveExpr = {
      $or: [
        { status: { $in: ['active', 'ACTIVE'] } },
        { status: true },
        { status: 1 },
        { 'profile.status': { $in: ['active', 'ACTIVE'] } },
        { 'profile.active': { $in: [true, 1] } },
        { 'status.value': { $in: ['active', 'ACTIVE'] } },
      ],
    };

    const [totalUsers, activeUsers] = await Promise.all([
      usersCol.countDocuments(tenantFilter),
      usersCol.countDocuments({ ...tenantFilter, ...statusActiveExpr }).catch(() => 0),
    ]);

    try {
      if (isAllTenantsBypass) {
        res.set('X-All-Tenants', 'true');
        res.set('X-Applied-Tenant', 'all-tenants');
      } else if (req.tenantId) {
        res.set('X-Applied-Tenant', String(req.tenantId));
      }
    } catch (_) {}

    return res.status(200).json({
      success: true,
      totalUsers,
      activeUsers: Number.isFinite(activeUsers) ? activeUsers : 0,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
