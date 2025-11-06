'use strict';

const express = require('express');
const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/costs/by-agent
 * Returns a minimal placeholder distribution.
 */
router.get('/by-agent', (req, res) => {
  res.status(200).json([]);
});

module.exports = router;
