const express = require('express');
const { asyncHandler } = require('../utils/http');
const { newUsersOverTime } = require('../controllers/analytics.controller');
const { getLlmCostByAgentController } = require('../controllers/llmCost.controller');
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
analyticsRouter.get(
  '/llm-cost-by-agent',
  verifyAuth,
  requireTenant,
  asyncHandler(getLlmCostByAgentController)
);

// New users over time
analyticsRouter.get('/users/new-over-time', verifyAuth, requireTenant, asyncHandler(newUsersOverTime));

module.exports = analyticsRouter;
