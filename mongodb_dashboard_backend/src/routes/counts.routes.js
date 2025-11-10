'use strict';

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../utils/http');

// Import models used for counting
const User = require('../models/user.model');
const SessionTracking = require('../models/sessionTracking.model');

/**
 * PUBLIC_INTERFACE
 * GET /api/users/count
 * Returns total number of users. Falls back to distinct user_id in session_tracking when users collection is empty.
 *
 * Response:
 *  { success: true, total: number }
 */
router.get(
  '/users/count',
  asyncHandler(async (req, res) => {
    // Enforce scoping if caller provides organization_id (query or headers)
    const orgHeader =
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      (typeof req.headers['x-org-id'] === 'string' && req.headers['x-org-id'].trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
      '';
    const orgQuery = typeof req.query.organization_id === 'string' ? req.query.organization_id.trim() : '';
    const enforcedOrg = orgQuery || orgHeader || null;

    const enforcedScope = enforcedOrg
      ? { $or: [{ tenant_id: enforcedOrg }, { organization_id: enforcedOrg }, { organizationId: enforcedOrg }] }
      : {};

    // Count users; if collection missing or error, treat as 0
    let usersCount = await User.countDocuments(enforcedScope).catch(() => 0);

    if ((!usersCount || Number(usersCount) === 0) && enforcedOrg) {
      try {
        const distinctUsers = await SessionTracking.distinct('user_id', { tenant_id: enforcedOrg }).catch(() => []);
        usersCount = Array.isArray(distinctUsers)
          ? distinctUsers.filter((u) => u !== null && u !== undefined && String(u).trim() !== '').length
          : 0;
      } catch {
        usersCount = 0;
      }
    }

    const debugEnabled = String(req.query.debug || 'false') === 'true';
    const meta = debugEnabled ? { debug: { enforcedScope } } : undefined;

    return res.status(200).json({
      success: true,
      total: Number.isFinite(Number(usersCount)) ? Number(usersCount) : 0,
      ...(meta ? { meta } : {}),
    });
  })
);

/**
 * PUBLIC_INTERFACE
 * GET /health
 * Lightweight health for this router namespace
 */
router.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

module.exports = router;
