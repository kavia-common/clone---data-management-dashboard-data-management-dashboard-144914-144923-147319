'use strict';

/**
 * This legacy route file previously depended on ../controllers/users.analytics.summary.controller
 * which has been removed. To avoid MODULE_NOT_FOUND on startup, we expose a minimal no-op router.
 * The canonical implementation for /api/users/tenant-summary now lives in src/routes/users.routes.js.
 *
 * NOTE (2025-12-19): No "Activity by Department" backend route exists; nothing to delete here.
 */

const express = require('express');
const router = express.Router();

// PUBLIC_INTERFACE
router.get('/tenant-summary', (req, res) => {
  /** This placeholder exists to maintain compatibility if mounted inadvertently elsewhere.
   * Prefer: src/routes/users.routes.js which implements the real aggregation.
   */
  return res.status(200).json({ items: [], total: 0, note: 'Placeholder handler; use /api/users/tenant-summary from users.routes.js' });
});

module.exports = router;
