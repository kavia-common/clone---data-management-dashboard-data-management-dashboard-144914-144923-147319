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

  const bypass = !!(req && (req.tenantScopeDisabled || req.allTenants || req?.user?.isSuperAdmin));
  const userFilter = bypass ? {} : { tenant_id: tenantId };
  const appFilter = bypass ? {} : { tenant_id: tenantId };

  const [usersCount, appsCount] = await Promise.all([
    usersCol.countDocuments(userFilter),
    appsCol.countDocuments(appFilter),
  ]);

  return { totalUsers: usersCount, totalDeployedApps: appsCount };
}

// PUBLIC_INTERFACE
module.exports = {
  getOverviewTotals,
};
