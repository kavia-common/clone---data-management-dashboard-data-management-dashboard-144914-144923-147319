'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');
const { extractOrganization } = require('../middleware/extractOrganization');
const SessionTracking = require('../models/sessionTracking.model');

/**
 * PUBLIC_INTERFACE
 * Users Projects Router
 * Handles GET /api/users/:userId/projects with explicit diagnostics.
 */
const router = express.Router();

// Apply auth+tenant where available; also allow extractOrganization for demo/header mode
router.use(extractOrganization());

// PUBLIC_INTERFACE
// GET /api/users/:userId/projects
router.get(
  '/:userId/projects',
  asyncHandler(async (req, res) => {
    // Allow JWT path or header path; if Authorization present, verify it first.
    // We won't strictly require JWT here; requireTenant is applied at app-level in many mounts,
    // but we enforce tenant presence below anyway.
    const { userId } = req.params || {};
    const normalizedUserId = String(userId || '').trim();

    const tenantId = req.organizationId || req.tenantId;
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message:
          'Missing tenant scope: include Authorization (JWT) or header x-organization-id or query ?tenant_id / ?organization_id',
      });
    }
    if (!normalizedUserId) {
      return res.status(400).json({ success: false, message: 'userId path parameter is required' });
    }

    // Diagnostics: collection and DB name + applied filter and probe count
    try {
      res.set('X-Endpoint', 'users-user-projects');
      res.set('X-User-Id', normalizedUserId);
      res.set('X-Applied-Tenant', String(tenantId));
      res.set('x-applied-organization-id', String(tenantId));
      const mongoose = require('mongoose');
      const dbName = mongoose?.connection?.name || mongoose?.connection?.db?.databaseName || '(unknown)';
      res.set('X-DB-Name', dbName);
      // SessionTracking model collection name
      try {
        res.set('X-Model-Collection', SessionTracking.collection?.name || 'session_tracking');
      } catch (_) {}
    } catch (_) {}

    const { from, to } = req.query || {};

    // Build a probe filter to count matching sessions for quick diagnostics
    const probeFilter = {
      tenant_id: String(tenantId),
      $expr: { $eq: [{ $toString: '$user_id' }, normalizedUserId] },
    };
    try {
      const probeCount = await SessionTracking.countDocuments(probeFilter);
      res.set('X-Probe-Count', String(probeCount));
      res.set('x-applied-tenant-filter', JSON.stringify(probeFilter));
      // Ensure browsers can read these diagnostic headers
      res.set(
        'Access-Control-Expose-Headers',
        'Content-Type,Content-Length,X-Endpoint,X-User-Id,X-Applied-Tenant,x-applied-organization-id,x-applied-tenant-filter,X-DB-Name,X-Model-Collection,X-Probe-Count'
      );
    } catch (_) {}

    // Delegate to existing service for consistent behavior
    const { getUserProjectsFromSessions } = require('../services/users.service');
    const payload = await getUserProjectsFromSessions({
      tenantId: String(tenantId),
      userId: normalizedUserId,
      from,
      to,
    });

    const page = Number(req.query.page || 0);
    const limit = Number(req.query.limit || 0);
    if (page > 0 && limit > 0) {
      const start = (page - 1) * limit;
      const end = start + limit;
      const sliced = (payload.projects || []).slice(start, end);
      return res.status(200).json({
        success: true,
        data: sliced,
        meta: { page, limit, total: (payload.projects || []).length },
        user_id: payload.user_id,
        tenant_id: payload.tenant_id,
      });
    }

    return res.status(200).json(payload);
  })
);

module.exports = router;
