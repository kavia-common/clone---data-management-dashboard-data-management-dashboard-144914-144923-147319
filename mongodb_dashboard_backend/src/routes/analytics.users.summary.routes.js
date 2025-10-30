'use strict';

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../utils/http');
const { getUsersTenantSummary } = require('../controllers/users.analytics.summary.controller');

/**
 * PUBLIC_INTERFACE
 * GET /api/analytics/users/tenant-summary
 * Canonical alias to /api/users/tenant-summary (kept for compatibility)
 * Returns an array [{ tenant, count }]
 */
router.get(
  '/tenant-summary',
  asyncHandler(async (req, res) => {
    const fakeRes = {
      _status: 200,
      _sent: false,
      status(code) { this._status = code; return this; },
      json(payload) { this._sent = true; this._payload = payload; return this; },
    };
    await getUsersTenantSummary(req, fakeRes);
    if (!fakeRes._sent) return res.status(500).json({ success: false, message: 'Controller did not respond' });
    if (fakeRes._status !== 200) return res.status(fakeRes._status).json(fakeRes._payload);
    const items = Array.isArray(fakeRes._payload?.items) ? fakeRes._payload.items : [];
    const mapped = items.map((it) => ({
      tenant: it.tenant_name || it.tenant_id || '',
      count: typeof it.user_count === 'number' ? it.user_count : 0,
    }));
    return res.status(200).json(mapped);
  })
);

module.exports = router;
