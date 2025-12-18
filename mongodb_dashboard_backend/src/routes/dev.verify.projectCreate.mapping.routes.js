'use strict';

const express = require('express');
const router = express.Router();

const { mappingDiagnostics } = require('../controllers/dev.verify.projectCreate.mapping.controller');

/**
 * PUBLIC_INTERFACE
 * GET /api/dev/verify/project-create/mapping
 * Returns mapping coverage between sessionTracking.user_id and users identifiers within strict filters.
 * Deterministic 200 JSON, never hangs.
 */
router.get('/project-create/mapping', mappingDiagnostics);

module.exports = router;
