const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * API Routes Index
 * Notes:
 * - Ensure static subpaths (e.g., /users/summary, /users/projects batch) are mounted
 *   before any dynamic /users/:id paths to avoid route capture issues.
 */

// Root ping for convenience
router.get('/', (req, res) => {
  const ready = mongoose.connection.readyState;
  const db = ready === 1 ? 'connected' : ready === 2 ? 'connecting' : 'disconnected';
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({
    success: true,
    status: 'ok',
    db,
    docs: '/api-docs',
    health: '/api/health',
    timestamp: new Date().toISOString(),
  });
});

// Analytics and dashboard
router.use('/analytics', require('./analytics'));
router.use('/analytics-agents', require('./analyticsAgents'));
router.use('/counts', require('./counts.routes'));
router.use('/dashboard', require('./dashboard.routes'));

// LLM costs
router.use('/llm-costs', require('./llmCosts.routes'));
router.use('/llm-costs-hierarchy', require('./llmCosts.hierarchy.routes'));
router.use('/llm-costs-aggregate', require('./llmCosts.aggregate.routes'));

// Projects
router.use('/projects', require('./projects.routes'));

// Session tracking
router.use('/session-tracking', require('./sessionTracking.routes'));
router.use('/session-tracking/composite', require('./sessionTracking.composite.routes'));

// Tenants
router.use('/tenants', require('./tenants.routes'));

// Users-related routes
router.use('/users/summary', require('./users.summary')); // static first
router.use('/users/projects', require('./users.projects.batch.routes')); // batch under /users/projects
router.use('/users', require('./users.projects.single.routes')); // provides /:userId/projects
router.use('/users', require('./users.projects.details.routes')); // provides /:userId/project-details
router.use('/users', require('./users.routes')); // generic users CRUD/list

// Dev and Auth
router.use('/dev', require('./dev.routes'));
router.use('/dev-verify', require('./dev.verify.routes'));
router.use('/auth', require('./auth.routes'));

module.exports = router;
