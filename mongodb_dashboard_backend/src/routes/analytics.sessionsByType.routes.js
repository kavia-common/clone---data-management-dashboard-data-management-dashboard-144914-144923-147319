'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { aggregateSessionsByType } = require('../services/analytics.sessionsByType.service');

/**
 * Router for consolidated Session Tracking analytics endpoints.
 */
const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/analytics/sessions-by-type
 * Summary: Aggregate session_tracking by service_type (feature) for a tenant and optional time window.
 * Description:
 *   Returns a chart-ready series in a single request, avoiding multiple list fetches and client-side aggregation.
 *   Accepts tenant scoping from:
 *     - query.tenant_id
 *     - headers: x-organization-id, x-tenant-id
 *   Optional time window via query.from, query.to (ISO date strings).
 *
 * Responses:
 *   200: { items: [{ feature: string, count: number }], total: number, meta: { from?: string, to?: string, tenant_id?: string } }
 *   400: { success: false, message: string }
 */
router.get(
  '/sessions-by-type',
  asyncHandler(async (req, res) => {
    // Resolve tenant scope (allow demo header usage)
    const tenantHeader =
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id']) ||
      (typeof req.headers['x-org-id'] === 'string' && req.headers['x-org-id']) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id']) ||
      undefined;

    const tenantQuery =
      (typeof req.query.tenant_id === 'string' && req.query.tenant_id) ||
      (typeof req.query.organization_id === 'string' && req.query.organization_id) ||
      undefined;

    const tenantId = tenantHeader || tenantQuery || req.tenantId || null;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'tenant_id is required via query (?tenant_id=...) or headers (x-organization-id).',
      });
    }

    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;

    // Execute single aggregation call
    const rows = await aggregateSessionsByType(tenantId, { from, to });

    // Normalize to chart-ready items
    const items = (rows || []).map((r) => ({
      feature: r.service_type || 'Unknown',
      count: typeof r.total === 'number' ? r.total : 0,
    }));

    const total = items.reduce((acc, it) => acc + (it.count || 0), 0);

    try {
      res.set('X-Applied-Tenant', String(tenantId));
    } catch {}

    return res.json({
      items,
      total,
      meta: {
        tenant_id: tenantId,
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      },
    });
  })
);

module.exports = router;
