'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');

// Do NOT require controllers at module load to avoid startup crashes if files are missing.
// Provide minimal inline handlers that keep the API responsive.
const analyticsRouter = express.Router();

/**
 * PUBLIC_INTERFACE
 * Analytics Router
 * Routes are mounted behind verifyAuth + requireTenant at app level where applicable.
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

// Cost by agent - minimal safe fallback to avoid require-time dependency errors
analyticsRouter.get(
  '/llm-cost-by-agent',
  asyncHandler(async (req, res) => {
    // Return empty structure to keep frontend stable; real logic may be mounted elsewhere
    return res.status(200).json({ items: [], total: 0 });
  })
);

// New users over time - minimal safe fallback
analyticsRouter.get(
  '/users/new-over-time',
  asyncHandler(async (req, res) => {
    return res.status(200).json({ items: [], meta: { granularity: req.query?.granularity || 'day' } });
  })
);

module.exports = analyticsRouter;
