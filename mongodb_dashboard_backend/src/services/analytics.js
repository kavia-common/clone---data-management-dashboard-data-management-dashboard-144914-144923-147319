'use strict';

const db = require('../config/db');

/**
 * PUBLIC_INTERFACE
 * getOverviewTotals
 * Returns totals for users and app_deployments for a tenant.
 */
async function getOverviewTotals(tenantId) {
  const dbo = await db.getDb();
  const usersCol = dbo.collection('users');
  const appsCol = dbo.collection('app_deployments');

  const [usersCount, appsCount] = await Promise.all([
    usersCol.countDocuments({ tenant_id: tenantId }),
    appsCol.countDocuments({ tenant_id: tenantId }),
  ]);

  return { totalUsers: usersCount, totalDeployedApps: appsCount };
}

const analyticsService = { getOverviewTotals };
module.exports = analyticsService;
