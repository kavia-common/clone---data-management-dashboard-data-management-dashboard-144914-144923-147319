'use strict';

const AnalyticsService = require('../services/analytics');

/**
 * PUBLIC_INTERFACE
 * overviewMetrics
 * Controller to compute dashboard overview totals for the authenticated tenant.
 * Expects verifyAuth and requireTenant middleware to have set req.auth.tenantId.
 *
 * Params:
 * - req: Express.Request with auth context
 * - res: Express.Response
 *
 * Returns:
 * - 200 JSON { success: true, totalUsers, totalDeployedApps, ... }
 * - 403 if tenant is missing
 * - 500 on internal errors
 */
exports.overviewMetrics = async (req, res) => {
  try {
    const tenantId = req?.auth?.tenantId;
    if (!tenantId) {
      return res.status(403).json({ success: false, message: 'Tenant required' });
    }
    const totals = await AnalyticsService.getOverviewTotals(tenantId);
    return res.json({ success: true, ...totals });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
