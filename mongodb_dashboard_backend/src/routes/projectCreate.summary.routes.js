'use strict';

const express = require('express');
const router = express.Router();

const { getProjectCreateSummary } = require('../controllers/projectCreateSummary.controller');

// PUBLIC_INTERFACE
// GET /api/project-create/summary
// Minimal route to provide bar chart data from SessionTracking grouped by project.
// NOTE: This router is mounted at '/api/project-create' in src/routes/index.js.
// Therefore define the path here as '/summary' (NOT '/project-create/summary').
router.get('/summary', getProjectCreateSummary);

// Lightweight ping route to verify router wiring responds deterministically.
router.get('/__ping', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, route: 'project-create', path: req.originalUrl });
});

module.exports = router;
