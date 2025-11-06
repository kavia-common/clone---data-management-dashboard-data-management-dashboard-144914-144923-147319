'use strict';

const express = require('express');
const router = express.Router();
const { getUsersTenantSummary } = require('../controllers/users.analytics.summary.controller');

// PUBLIC_INTERFACE
// GET /api/users/tenant-summary
router.get('/tenant-summary', async (req, res) => getUsersTenantSummary(req, res));

module.exports = router;
