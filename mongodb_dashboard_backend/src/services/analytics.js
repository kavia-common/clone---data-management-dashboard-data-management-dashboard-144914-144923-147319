'use strict';

const db = require('../config/db');

/**
 * Overview total metrics for a tenant.
 */
// PUBLIC_INTERFACE
async function getOverviewTotals(tenantId) {
  const { users, app_deployments } = db.getCollections ? db.getCollections() : { users: null, app_deployments: null };
  if (!users || !app_deployments) {
    // Fallback if helper not available; try via db.get()
    const dbo = db.get?.();
    const usersCol = dbo?.collection ? dbo.collection('users') : null;
    const appsCol = dbo?.collection ? dbo.collection('app_deployments') : null;
    const usersCount = usersCol ? await usersCol.countDocuments({ tenant_id: tenantId }) : 0;
    const appsCount = appsCol ? await appsCol.countDocuments({ tenant_id: tenantId }) : 0;
    return { totalUsers: usersCount, totalDeployedApps: appsCount };
  }

  // Count docs within tenant only
  const usersCount = await users.countDocuments({ tenant_id: tenantId });
  const appsCount = await app_deployments.countDocuments({ tenant_id: tenantId });
  if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
    try { console.debug('[analytics.getOverviewTotals] tenantFilter', { tenant_id: tenantId }); } catch {}
  }

  return { totalUsers: usersCount, totalDeployedApps: appsCount };
}

module.exports = {
  getOverviewTotals,
};
