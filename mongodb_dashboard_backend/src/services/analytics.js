'use strict';

const db = require('../config/db');

/**
 * PUBLIC_INTERFACE
 * getOverviewTotals
 * Returns totals for users and app_deployments for a tenant.
 * @param {string} tenantId - Tenant identifier to scope counts
 * @param {object} [req] - Express request for bypass flags (isSuperAdmin/allTenants/tenantScopeDisabled)
 * @returns {Promise<{ totalUsers: number, totalDeployedApps: number }>}
 */
async function getOverviewTotals(tenantId, req = undefined) {
  const dbo = await db.getDb();
  const usersCol = dbo.collection('users');
  const appsCol = dbo.collection('app_deployments');

  // Super Admin bypass: omit tenant filter if bypass flags present
  const bypass = !!(req && (req.tenantScopeDisabled || req.allTenants || req?.user?.isSuperAdmin));
  const userFilter = bypass ? {} : { tenant_id: tenantId };
  const appFilter = bypass ? {} : { tenant_id: tenantId };
  if (bypass) {
    // Diagnostics for verification
    // eslint-disable-next-line no-console
    console.log('[analytics.service.getOverviewTotals] bypass active -> counting across all tenants');
  }

  const [usersCount, appsCount] = await Promise.all([
    usersCol.countDocuments(userFilter),
    appsCol.countDocuments(appFilter),
  ]);

  return { totalUsers: usersCount, totalDeployedApps: appsCount };
}

/**
 * PUBLIC_INTERFACE
 * analyticsService
 * Named export object for analytics helpers to avoid anonymous default export patterns.
 */
const analyticsService = { getOverviewTotals };

module.exports = analyticsService;
