'use strict';

/**
 * PUBLIC_INTERFACE
 * GET /health - Lightweight health check for the backend service
 * - Returns 200 OK with { status: 'ok', time } to indicate process is alive.
 * This route is intentionally simple and unauthenticated.
 */
const express = require('express');
const router = express.Router();

// PUBLIC_INTERFACE
router.get('/health', (req, res) => {
  /** Health check endpoint returning ok status and server time. */
  return res.status(200).json({ status: 'ok', time: new Date().toISOString() });
});

module.exports = router;
