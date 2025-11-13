'use strict';

const express = require('express');
const router = express.Router();

// Import after controller is created
const { getUserProjects } = require('../controllers/users.projects.controller');
const { extractOrganization } = require('../middleware/extractOrganization');

// Route: mounted under /api/users in users.routes.js; final path: /api/users/:userId/projects
// Add extractOrganization to read x-organization-id or tenant/organization query and expose req.tenantId
router.get('/:userId/projects', extractOrganization(), (req, res, next) => {
  const debug = process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true';
  if (debug) {
    try {
      // eslint-disable-next-line no-console
      console.debug(
        `[users.projects] GET ${req.originalUrl} x-org=${req.headers['x-organization-id'] || 'n/a'} tenant_id=${req.query.tenant_id || 'n/a'}`
      );
    } catch {}
  }
  return getUserProjects(req, res, next);
});

module.exports = router;
