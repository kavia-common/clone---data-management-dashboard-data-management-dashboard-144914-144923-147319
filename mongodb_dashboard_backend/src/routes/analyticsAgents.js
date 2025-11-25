

const express = require('express');
const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * Minimal agents analytics route placeholder
 * GET /api/analytics/agents
 */
router.get('/', (req, res) => {
  res.status(200).json({ items: [], total: 0, meta: { limit: 50, offset: 0 } });
});

module.exports = router;
