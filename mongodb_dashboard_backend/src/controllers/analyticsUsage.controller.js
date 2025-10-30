'use strict';

const asyncHandler = require('../middleware/standardHandlers').asyncHandler;
const { groupByAgents, groupByTeams, usageByUser, featuresByCredit } = require('../services/analyticsUsage.service');

/**
 * Normalize common query params and defaults
 */
function normalizeQuery(q) {
  const {
    from,
    to,
    tenant_id,
    project_id,
    user_id,
    status,
    limit,
    top,
    bottom
  } = q || {};

  return {
    from,
    to,
    tenant_id,
    project_id,
    user_id,
    status,
    limit,
    top,
    bottom
  };
}

// PUBLIC_INTERFACE
const getGroupByAgents = asyncHandler(async (req, res) => {
  /** Returns totals grouped by agent with optional filters and last-30-days default. */
  const params = normalizeQuery(req.query);
  const result = await groupByAgents(params);
  res.json({ success: true, data: result.items, meta: result.meta });
});

// PUBLIC_INTERFACE
const getGroupByTeams = asyncHandler(async (req, res) => {
  /** Returns totals grouped by team_id with optional filters and last-30-days default. */
  const params = normalizeQuery(req.query);
  const result = await groupByTeams(params);
  res.json({ success: true, data: result.items, meta: result.meta });
});

// PUBLIC_INTERFACE
const getUsageByUser = asyncHandler(async (req, res) => {
  /** Returns sessions/calls/tokens/cost per user with basic display info. */
  const params = normalizeQuery(req.query);
  const result = await usageByUser(params);
  res.json({ success: true, data: result.items, meta: result.meta });
});

// PUBLIC_INTERFACE
const getFeaturesByCredit = asyncHandler(async (req, res) => {
  /** Returns most/least used features by credit consumption with top/bottom lists. */
  const params = normalizeQuery(req.query);
  const result = await featuresByCredit(params);
  res.json({ success: true, data: result.items, meta: result.meta });
});

module.exports = {
  getGroupByAgents,
  getGroupByTeams,
  getUsageByUser,
  getFeaturesByCredit
};
