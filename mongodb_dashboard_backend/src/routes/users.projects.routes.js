'use strict';

const express = require('express');
const router = express.Router();

const { getUserProjects } = require('../controllers/users.projects.controller');

/**
 * Route: GET /api/users/:userId/projects
 * Summary: Get projects associated with a user (from session tracking)
 * Description: Returns distinct projects the user has activity in, based on the session_tracking collection. Optional time range can be provided using "from" and "to" query parameters.
 * Query Params:
 *  - tenant_id (required): Tenant (organization) ID to scope the query. Alias organization_id supported.
 *  - from (optional ISO date-time)
 *  - to (optional ISO date-time)
 * Response:
 *  {
 *    user_id: string,
 *    tenant_id: string,
 *    projects: [{ project_id: string, project_name: string|null, last_activity: ISO string|null }]
 *  }
 */
router.get('/:userId/projects', getUserProjects);

module.exports = router;
