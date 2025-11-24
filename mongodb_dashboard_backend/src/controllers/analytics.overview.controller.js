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
    // Parse optional time-range parameters for future analytics expansion
    const { range, metric, from, to } = req.query || {};
    // TODO: Wire to a time-bucketed analytics service when implemented.
    // For now, return totals (backward compatible).
    const totals = await AnalyticsService.getOverviewTotals(tenantId);
    return res.json({
      success: true,
      query: { range: range || null, metric: metric || null, from: from || null, to: to || null },
      ...totals
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

const overviewController = { overviewMetrics };
module.exports = overviewController;
