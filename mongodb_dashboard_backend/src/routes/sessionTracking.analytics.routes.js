'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const {
  computeSessionsByOrganizationFlow,
  computeSessionsByTypeFlow,
  computeMostLeastUsedServicesFlow,
} = require('../services/sessionTracking.analytics');
const { resolveTenantContextFromRequest } = require('../services/tenantContextResolve');

const router = express.Router();

/**
 * Resolve tenant and bypass flags (shared flow with T0000 sentinel support).
 * Contract:
 * - Returns { bypass:boolean, tenantId:string|null, requestedTenantRaw?:string|null }
 */
function resolveTenantContext(req) {
  return resolveTenantContextFromRequest(req);
}

/**
 * PUBLIC_INTERFACE
 * GET /api/session-tracking/analytics/by-organization
 *
 * Query:
 * - tenant_id (required unless bypass/all-tenants)
 * - q (optional, same text search as /api/session-tracking)
 *
 * Response:
 * - Array<{ organization_name, session_count }>
 */
router.get(
  '/by-organization',
  asyncHandler(async (req, res) => {
    const { bypass, tenantId } = resolveTenantContext(req);
    if (!bypass && !tenantId) {
      return res.status(400).json({
        success: false,
        message: 'tenant_id is required. Provide ?tenant_id=...',
      });
    }

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const rows = await computeSessionsByOrganizationFlow({
      tenantId,
      bypass,
      q,
    });

    return res.status(200).json({
      success: true,
      data: rows,
      meta: {
        tenant_id: bypass ? 'all-tenants' : tenantId,
        q: q || null,
        count: Array.isArray(rows) ? rows.length : 0,
      },
    });
  })
);

/**
 * PUBLIC_INTERFACE
 * GET /api/session-tracking/analytics/by-type
 *
 * Query:
 * - tenant_id (required unless bypass/all-tenants)
 * - q (optional)
 *
 * Response:
 * - Array<{ session_type, session_count }>
 */
router.get(
  '/by-type',
  asyncHandler(async (req, res) => {
    const { bypass, tenantId } = resolveTenantContext(req);
    if (!bypass && !tenantId) {
      return res.status(400).json({
        success: false,
        message: 'tenant_id is required. Provide ?tenant_id=...',
      });
    }

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const rows = await computeSessionsByTypeFlow({
      tenantId,
      bypass,
      q,
    });

    return res.status(200).json({
      success: true,
      data: rows,
      meta: {
        tenant_id: bypass ? 'all-tenants' : tenantId,
        q: q || null,
        count: Array.isArray(rows) ? rows.length : 0,
      },
    });
  })
);

/**
 * PUBLIC_INTERFACE
 * GET /api/session-tracking/analytics/most-least-used
 *
 * Query:
 * - tenant_id (required unless bypass/all-tenants)
 * - q (optional)
 * - maxItems (optional, default 5)
 *
 * Response:
 * - { mostUsed: Array<{session_type, session_count}>, leastUsed: Array<{session_type, session_count}> }
 */
router.get(
  '/most-least-used',
  asyncHandler(async (req, res) => {
    const { bypass, tenantId } = resolveTenantContext(req);
    if (!bypass && !tenantId) {
      return res.status(400).json({
        success: false,
        message: 'tenant_id is required. Provide ?tenant_id=...',
      });
    }

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const maxItems = req.query.maxItems !== undefined ? Number(req.query.maxItems) : 5;

    const payload = await computeMostLeastUsedServicesFlow({
      tenantId,
      bypass,
      q,
      maxItems,
    });

    return res.status(200).json({
      success: true,
      data: payload,
      meta: {
        tenant_id: bypass ? 'all-tenants' : tenantId,
        q: q || null,
        maxItems: Math.max(0, Number(maxItems) || 5),
      },
    });
  })
);

module.exports = router;
