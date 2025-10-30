'use strict';

/**
 * Users Insights Controller
 * Wires request queries to UsersInsightsService and formats responses consistently.
 */

const UsersInsightsService = require('../services/users.insights.service');
const { sendOk, sendError } = require('../middleware/standardHandlers');

// PUBLIC_INTERFACE
async function activity(req, res) {
  /** GET /api/users/activity?period=daily|weekly|monthly — returns total active users for period. */
  try {
    const { period } = req.query;
    const data = await UsersInsightsService.getActivitySummary({ period });
    return sendOk(res, data);
  } catch (err) {
    return sendError(res, err);
  }
}

// PUBLIC_INTERFACE
async function trends(req, res) {
  /** GET /api/users/trends — 30-day active users trend with daily buckets. */
  try {
    const { from, to } = req.query;
    const data = await UsersInsightsService.getActiveUsersTrend({ from, to });
    return sendOk(res, data);
  } catch (err) {
    return sendError(res, err);
  }
}

// PUBLIC_INTERFACE
async function organizations(req, res) {
  /** GET /api/users/organizations — active users grouped by organization_id. */
  try {
    const { from, to } = req.query;
    const data = await UsersInsightsService.getByOrganization({ from, to });
    return sendOk(res, data);
  } catch (err) {
    return sendError(res, err);
  }
}

// PUBLIC_INTERFACE
async function departments(req, res) {
  /** GET /api/users/departments — active users grouped by department. */
  try {
    const { from, to } = req.query;
    const data = await UsersInsightsService.getByDepartment({ from, to });
    return sendOk(res, data);
  } catch (err) {
    return sendError(res, err);
  }
}

// PUBLIC_INTERFACE
async function compliance(req, res) {
  /** GET /api/users/compliance — terms acceptance totals and rates (+ optional MFA/inactivity). */
  try {
    const { from, to } = req.query;
    const data = await UsersInsightsService.getCompliance({ from, to });
    return sendOk(res, data);
  } catch (err) {
    return sendError(res, err);
  }
}

// PUBLIC_INTERFACE
async function engagementTrend(req, res) {
  /** GET /api/users/engagement-trend — time series of distinct active users and sessions. */
  try {
    const { from, to, granularity } = req.query;
    const data = await UsersInsightsService.getEngagementTrend({ from, to, granularity });
    return sendOk(res, data);
  } catch (err) {
    return sendError(res, err);
  }
}

// PUBLIC_INTERFACE
async function kpis(req, res) {
  /** GET /api/users/kpis — window KPIs: newUsers, activeUsers, returningUsers, avgSessionsPerUser. */
  try {
    const { from, to } = req.query;
    const data = await UsersInsightsService.getKpis({ from, to });
    return sendOk(res, data);
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = {
  activity,
  trends,
  organizations,
  departments,
  compliance,
  engagementTrend,
  kpis,
};
