'use strict';

const express = require('express');
const router = express.Router();

const { getProjectCreateSummary } = require('../controllers/projectCreateSummary.controller');

// PUBLIC_INTERFACE
// GET /api/project-create/summary
// Minimal route to provide bar chart data from SessionTracking grouped by project.
router.get('/project-create/summary', getProjectCreateSummary);

module.exports = router;
