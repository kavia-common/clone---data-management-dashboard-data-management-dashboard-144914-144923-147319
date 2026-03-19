const express = require('express');

/**
 * Session Tracking Table Routes
 *
 * This router exists to provide a stable, isolated endpoint for the Sessions page
 * *table* list fetch. The composite/analytics endpoints should not share query state
 * with the table list request in the frontend.
 *
 * Implementation notes:
 * - We reuse the exact same handler flow as the existing /api/session-tracking GET list.
 * - We mount it under a different path so callers can clearly separate concerns.
 * - This avoids patchy duplication: we delegate to the already-maintained list router.
 */

const listRouter = require('./sessionTracking.routes');

const router = express.Router();

// PUBLIC_INTERFACE
router.use('/', listRouter);
/** This router re-exports the existing session tracking list+CRUD behavior under a table-specific base path. */

module.exports = router;
