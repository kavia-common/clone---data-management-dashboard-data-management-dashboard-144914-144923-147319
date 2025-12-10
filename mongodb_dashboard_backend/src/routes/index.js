const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

// Mount users routes, including /summary
const usersSummaryRoutes = require('./users.summary');

router.use('/users', usersSummaryRoutes);

/**
 * PUBLIC_INTERFACE
 * GET /
 * Basic service status for root path. Returns 200 OK with health summary and pointers
 * to documentation. This is intentionally lightweight and unauthenticated so that
 * curl / returns something useful in environments where the frontend or ops probes
 * may ping the root path.
 */
router.get('/', (req, res) => {
  const ready = mongoose.connection.readyState;
  const db = ready === 1 ? 'connected' : ready === 2 ? 'connecting' : 'disconnected';
  const payload = {
    success: true,
    status: 'ok',
    db,
    docs: '/api-docs',
    health: '/api/health',
    timestamp: new Date().toISOString(),
    message: 'Welcome to the Dashboard API. See /api-docs for the full OpenAPI.',
  };
  res.set('Cache-Control', 'no-store');
  return res.status(200).json(payload);
});

module.exports = router;
