'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const User = require('../models/user.model');
const SessionTracking = require('../models/sessionTracking.model');
const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/users/count
 * Returns total number of users. Falls back to distinct user_id in session_tracking when users collection is empty.
 *
 * Response:
 *  { success: true, total: number }
 */
const { requireTenant } = require('../middleware/requireTenant');

router.get(
  '/users/count',
  requireTenant,
  asyncHandler(async (req, res) => {
    // Enforce scoping strictly using resolved tenant from middleware
    const enforcedOrg = String(req.tenantId);

    const enforcedScope = { tenant_id: enforcedOrg };

    let usersCount = 0;
    try {
      usersCount = await User.countDocuments(enforcedScope);
    } catch {
      usersCount = 0;
    }

    if (!usersCount || Number(usersCount) === 0) {
      try {
        const distinctUsers = await SessionTracking.distinct('user_id', { tenant_id: enforcedOrg }).catch(() => []);
        usersCount = Array.isArray(distinctUsers)
          ? distinctUsers.filter((u) => u !== null && u !== undefined && String(u).trim() !== '').length
          : 0;
      } catch {
        usersCount = 0;
      }
    }

    return res.status(200).json({
      success: true,
      total: Number.isFinite(Number(usersCount)) ? Number(usersCount) : 0,
    });
  })
);

/**
 * PUBLIC_INTERFACE
 * GET /health
 * Simple health on this router, used by base router as lightweight readiness.
 */
router.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

module.exports = router;
