'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { requireTenant } = require('../middleware/requireTenant');
const { verifyAuth } = require('../middleware/verifyAuth');
const { extractOrganization } = require('../middleware/extractOrganization');
const SessionTracking = require('../models/sessionTracking.model');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/sessions/:sessionId/breaks
 * Returns session + session_breakdown details for a given sessionId, scoped to the active tenant.
 *
 * Accepts aliases for session identifier: _id, id, session_id, sessionId, session_data.session_id/sessionId
 * Responds 404 if not found under the user's tenant.
 *
 * Swagger/OpenAPI:
 */
/**
 * @swagger
 * /api/sessions/{sessionId}/breaks:
 *   get:
 *     summary: Get session-break details by sessionId
 *     description: >
 *       Returns a single session tracking document and its session_breakdown fields for the specified sessionId.  
 *       The result is scoped by the active tenant (derived from auth context).  
 *       The endpoint matches session identifiers by any of the following fields:
 *       `_id`, `id`, `session_id`, `sessionId`, `session_data.session_id`, or `session_data.sessionId`.
 *     tags:
 *       - SessionTracking
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session identifier to look up
 *     parameters:
 *       - in: header
 *         name: x-organization-id
 *         required: false
 *         schema:
 *           type: string
 *         description: Tenant (organization) ID. Required when JWT is not provided; ignored if JWT is present with tenant.
 *       - in: query
 *         name: organization_id
 *         required: false
 *         schema:
 *           type: string
 *         description: Alias for tenant filter. Ignored when JWT is present. Header takes precedence over query.
 *       - in: query
 *         name: tenant_id
 *         required: false
 *         schema:
 *           type: string
 *         description: Alias for tenant filter. Ignored when JWT is present. Header takes precedence over query.
 *     responses:
 *       200:
 *         description: Session details with breakdown when found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 *       404:
 *         description: Session not found for the active tenant
 *       400:
 *         description: Invalid input
 */
router.get(
  '/:sessionId/breaks',
  verifyAuth(),          // attach req.user and req.tenantId if using auth
  extractOrganization(), // fallback: derive tenant from header/query when no JWT
  requireTenant(),       // ensures req.tenantId is present
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
      return res.status(400).json({ success: false, message: 'Invalid sessionId' });
    }

    // Build cross-field match for session identifier
    const idStr = String(sessionId);
    const idMatch = {
      $or: [
        { _id: idStr },               // string match (driver may cast if ObjectId)
        { id: idStr },
        { session_id: idStr },
        { sessionId: idStr },
        { 'session_data.session_id': idStr },
        { 'session_data.sessionId': idStr },
      ],
    };

    // Enforce tenant scope with robust aliases
    const tenant = String(req.tenantId);
    const tenantScope = {
      $or: [
        { tenant_id: tenant },
        { organization_id: tenant },
        { organizationId: tenant },
        { tenantId: tenant },
        { orgId: tenant },
        { 'tenant.tenant_id': tenant },
      ],
    };

    // Query with allowDiskUse for larger indexes; prefer lean for performance
    const doc = await SessionTracking.findOne({ $and: [idMatch, tenantScope] })
      .allowDiskUse?.(true)
      .lean();

    if (!doc) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    // Optional: basic normalization for cost numbers if present (mirrors list behavior lightly)
    const out = { ...doc };
    return res.status(200).json(out);
  })
);

module.exports = router;
