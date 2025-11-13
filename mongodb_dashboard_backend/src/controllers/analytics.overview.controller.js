'use strict';

const AnalyticsService = require('../services/analytics');

/**
 * Get dashboard overview totals for the authenticated tenant.
 */
// PUBLIC_INTERFACE
async function overviewMetrics(req, res) {
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
}

const overviewController = { overviewMetrics };
module.exports = overviewController;
