'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const User = require('../models/user.model');
const AppDeployment = require('../models/appDeployments.model');
const SessionTracking = require('../models/sessionTracking.model');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Counts
 *   description: Lightweight count endpoints for totals
 */

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

    let usersCount = await User.countDocuments(enforcedScope).catch(() => 0);

    if ((!usersCount || Number(usersCount) === 0) && enforcedOrg) {
      try {
        const distinctUsers = await SessionTracking.distinct('user_id', { tenant_id: enforcedOrg }).catch(() => []);
        usersCount = Array.isArray(distinctUsers)
          ? distinctUsers.filter(
              (u) => u !== null && u !== undefined && String(u).trim() !== ''
            ).length
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
 * GET /api/deployments/count
 * Returns total number of app deployments across all tenants.
 *
 * Response:
 *  { success: true, total: number }
 */
router.get(
  '/deployments/count',
  asyncHandler(async (_req, res) => {
    const deploymentsCount = await AppDeployment.countDocuments({}).catch(() => 0);

    return res.status(200).json({
      success: true,
      total: Number.isFinite(Number(deploymentsCount)) ? Number(deploymentsCount) : 0,
    });
  })
);

module.exports = router;
