'use strict';

const express = require('express');
const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/dev/smoke/pagination
 * Simple echo to verify pagination coercion and server limit cap behavior.
 * Returns current parsing of page/limit given query.
 */
router.get('/smoke/pagination', (req, res) => {
  const { parsePagination } = require('../utils/http');
  const { page, limit, cap, explicit } = parsePagination(req.query || {});
  return res.status(200).json({
    success: true,
    data: { page, limit, explicit, limitCap: cap },
    traceId: req.traceId || null,
  });
});

/**
 * PUBLIC_INTERFACE
 * GET /api/dev/smoke/q
 * Echo q normalization to confirm empty string is treated as undefined.
 */
router.get('/smoke/q', (req, res) => {
  const { normalizeQueryQ } = require('../utils/http');
  const raw = req.query.q;
  const normalized = normalizeQueryQ(raw);
  return res.status(200).json({
    success: true,
    data: { raw: raw === undefined ? undefined : String(raw), normalized: normalized ?? null },
    traceId: req.traceId || null,
  });
});

module.exports = router;
