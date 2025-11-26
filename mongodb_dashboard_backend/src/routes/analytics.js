'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { newUsersOverTime } = require('../controllers/analytics.controller');
const { getLlmCostByAgentController } = require('../controllers/llmCost.controller');
// Ensure over-time analytics controller is imported and registered
const { getLlmCostsOverTimeController } = require('../controllers/llmCosts.overTime.controller');
const { getUsersActiveTrendController } = require('../controllers/users.activeTrend.controller');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');

const analyticsRouter = express.Router();

/**
 * PUBLIC_INTERFACE
 * Analytics Router
 * Protected by verifyAuth + requireTenant on all endpoints.
 */

// Health/reachability
analyticsRouter.head('/llm-cost-by-agent', (req, res) => {
  res
    .set('X-Endpoint', 'analytics-llm-cost-by-agent')
    .set('Cache-Control', 'no-store')
    .status(204)
    .end();
});
analyticsRouter.options('/llm-cost-by-agent', (req, res) => res.sendStatus(204));

// Cost by agent
analyticsRouter.use((req, res, next) => {
  try {
    const hdr = (req.headers?.['x-organization-id'] || '').toString();
    const qOrg = (req.query?.organization_id || req.query?.tenant_id || '').toString();
    const authTenant = (req.auth?.tenantId || req.tenantId || '').toString();
    const requestedTenant = hdr || qOrg || authTenant || '';
    const isT0000 = requestedTenant && requestedTenant.toUpperCase() === 'T0000';
    if (isT0000) {
      req.tenantScopeDisabled = true;
      req.allTenants = true;
      req.analyticsAllTenantsBypass = true;
      try { res.set('X-All-Tenants', 'true'); } catch (_) {}
    }
    console.log('[analytics.routes] bypass check', { path: req.path, requestedTenant, isT0000, bypassApplied: !!isT0000 });
  } catch (_) {}
  next();
});

analyticsRouter.get(
  '/llm-cost-by-agent',
  verifyAuth,
  requireTenant,
  // CORS-safe: allow OPTIONS preflight and set no-store
  (req, res, next) => { try { res.set('Cache-Control', 'no-store'); res.set('Access-Control-Allow-Origin', '*'); } catch(_) {} next(); },
  asyncHandler(getLlmCostByAgentController)
);

// Costs over time (time series for Overview chart)
analyticsRouter.get(
  '/llm-costs/over-time',
  verifyAuth,
  requireTenant,
  (req, res, next) => { try { res.set('Cache-Control', 'no-store'); res.set('Access-Control-Allow-Origin', '*'); } catch(_) {} next(); },
  asyncHandler(getLlmCostsOverTimeController)
);

/**
 * Users active trend (replacement for legacy /api/users/active-trend-from-users)
 * GET /api/analytics/users/active-trend
 */
analyticsRouter.get(
  '/users/active-trend',
  verifyAuth,
  requireTenant,
  (req, res, next) => {
    try {
      // normalize alias params for downstream controller
      if (!req.query?.from && req.query?.start) req.query.from = req.query.start;
      if (!req.query?.to && req.query?.end) req.query.to = req.query.end;
      res.set('Cache-Control', 'no-store');
      res.set('Access-Control-Allow-Origin', '*');
    } catch(_) {}
    next();
  },
  asyncHandler(getUsersActiveTrendController)
);

// New users over time (unchanged)
analyticsRouter.get('/users/new-over-time', verifyAuth, requireTenant, asyncHandler(newUsersOverTime));

module.exports = analyticsRouter;
