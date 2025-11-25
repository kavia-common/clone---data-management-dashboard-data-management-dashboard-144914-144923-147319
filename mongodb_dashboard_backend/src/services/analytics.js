'use strict';

const db = require('../config/db');

/**
 * PUBLIC_INTERFACE
 * getOverviewTotals
 * Returns totals for users and app_deployments for a tenant.
 */
async function getOverviewTotals(tenantId, req = undefined) {
  const dbo = await db.getDb();
  const usersCol = dbo.collection('users');
  const appsCol = dbo.collection('app_deployments');

  // Super Admin bypass: omit tenant filter if bypass flags present
  const bypass = !!(req && (req.tenantScopeDisabled || req.allTenants || req?.user?.isSuperAdmin));
  const userFilter = bypass ? {} : { tenant_id: tenantId };
  const appFilter = bypass ? {} : { tenant_id: tenantId };

  const [usersCount, appsCount] = await Promise.all([
    usersCol.countDocuments(userFilter),
    appsCol.countDocuments(appFilter),
  ]);

  return { totalUsers: usersCount, totalDeployedApps: appsCount };
}

const analyticsService = { getOverviewTotals };
module.exports = analyticsService;
