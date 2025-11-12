'use strict';

const express = require('express');
const router = express.Router();

// Import controller first so the handler is loaded before route definition
const { getUserProjects } = require('../controllers/users.projects.controller');

/**
 * GET /api/users/:userId/projects
 * Handler: getUserProjects
 * Notes:
 *  - Path param: userId
 *  - Query: tenant_id (required), from (optional ISO), to (optional ISO)
 *  - This router is mounted under /api/users in users.routes.js, so we register as '/:userId/projects' here.
 */
router.get('/:userId/projects', getUserProjects);

module.exports = router;
