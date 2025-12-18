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
 *  - activeUsers: strictly users with status 'active' (lower/upper cased)
 *
 * Tenant scoping rules:
 *  - If organization_id (or tenant_id) = 'T0000' then return counts across ALL tenants (super-admin override).
 *  - Otherwise, return counts only within the resolved tenant (from JWT/header/query), strictly filtered by tenant and status.
 *  - Frontend may send ?organization_id=...; we map it to tenant semantics. Header x-organization-id is also supported.
 *  - When Authorization is present, upstream requireTenant enforces tenant consistency; conflicting tenant is rejected earlier.
 *
 * Safeguards:
 *  - If no usable tenant can be resolved and not T0000, respond 400 with a helpful message.
 */
router.get('/', verifyAuth, requireTenant, async (req, res, next) => {
  try {
    // Support both organization_id and tenant_id as inputs (headers take precedence over query)
    const headerOrg = (req.headers?.['x-organization-id'] || req.headers?.['x-tenant-id'] || '').toString().trim();
    const queryOrg = (req.query?.organization_id || '').toString().trim();
    const queryTid = (req.query?.tenant_id || '').toString().trim();
    const authTenant = (req.auth?.tenantId || '').toString().trim();

    // Effective requested organization/tenant id as supplied by client (used only to detect T0000)
    const requestedOrg = headerOrg || queryOrg || queryTid || authTenant;

    // Detect T0000 override (super-admin style across tenants)
    const isAllTenantsBypass = requestedOrg && String(requestedOrg).toUpperCase() === 'T0000';

    // When not bypassing, we must have an effective tenant id to filter
    const effectiveTenant = isAllTenantsBypass ? undefined : (req.tenantId || authTenant || headerOrg || queryOrg || queryTid || '').toString().trim();

    if (!isAllTenantsBypass && !effectiveTenant) {
      return res.status(400).json({
        success: false,
        message: 'organization_id (tenant) is required unless using T0000 super-admin override',
      });
    }

    const dbo = await getDb();
    const usersCol = dbo.collection('users');

    // Build tenant filter when required (non-T0000)
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

    // Active users: strictly status 'active' (case-insensitive). Accepts 'ACTIVE' variants.
    // Note: We intentionally do not treat boolean true/1 as active for this KPI per requirement.
    const statusActiveExpr = {
      $or: [
        { status: { $in: ['active', 'ACTIVE', 'Active'] } },
        { 'profile.status': { $in: ['active', 'ACTIVE', 'Active'] } },
        { 'status.value': { $in: ['active', 'ACTIVE', 'Active'] } },
      ],
    };

    // Compute totals:
    // - totalUsers in tenant (or all tenants if T0000)
    // - activeUsers filtered by status + tenant scope (if any)
    const [totalUsers, activeUsers] = await Promise.all([
      usersCol.countDocuments(tenantFilter),
      usersCol.countDocuments({ ...tenantFilter, ...statusActiveExpr }).catch(() => 0),
    ]);

    // Diagnostics headers
    try {
      res.set('X-Users-Tenant-Mode', isAllTenantsBypass ? 'all-tenants' : 'scoped');
      res.set('X-Effective-Tenant', isAllTenantsBypass ? 'T0000' : String(effectiveTenant || 'unknown'));
      res.set('X-Tenant-Filter', JSON.stringify(tenantFilter || {}));
    } catch {}

    // Maintain response shape; include totalUsers if previously present
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
