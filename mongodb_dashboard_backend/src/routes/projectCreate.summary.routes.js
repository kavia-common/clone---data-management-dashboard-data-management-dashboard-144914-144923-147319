'use strict';

const express = require('express');
const router = express.Router();

const { getProjectCreateSummary } = require('../controllers/projectCreateSummary.controller');

// PUBLIC_INTERFACE
// GET /api/project-create/summary
/**
 * PUBLIC_INTERFACE
 * GET /api/project-create/summary
 * Returns deterministic 200 with { success, buckets: [ { key, user_name, project_id, label, count } ], project_id? }.
 * - user_name is resolved from users collection using user_id via multi-key lookup
 * - project_id is included for verification
 * - Strict filters enforced: created_at UTC bounds, tenant_id exact, project_id exact (when provided)
 */
router.get('/summary', getProjectCreateSummary);

// Lightweight ping route to verify router wiring responds deterministically.
router.get('/__ping', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, route: 'project-create', path: req.originalUrl });
});

module.exports = router;
