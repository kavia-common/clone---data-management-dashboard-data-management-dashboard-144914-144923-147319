/**
 * NOTICE: /api/llm-costs removal
 * The public routes for /api/llm-costs have been removed per request.
 * This file remains as a placeholder to avoid require/import resolution errors.
 * If any code attempts to mount this router, it will effectively be a no-op.
 *
 * To re-enable, restore previous handlers and mount under src/routes/index.js.
 */
const express = require('express');
const router = express.Router();

// No routes are registered here intentionally. This documents the removal.
// Previously provided:
//   - GET /api/llm-costs
//   - GET /api/projects/:projectId/llm-costs (deprecated alias)
module.exports = router;