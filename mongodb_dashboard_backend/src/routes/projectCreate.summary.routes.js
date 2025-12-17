'use strict';

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const SessionTracking = require('../models/sessionTracking.model');

/**
 * PUBLIC_INTERFACE
 * GET /api/project-create/summary
 * Returns summary counts of created sessions grouped by project_id, filtered by organization_id/tenant_id.
 *
 * Query:
 * - organization_id (alias: tenant_id): required unless global bypass is active (T0000)
 *
 * Response:
 *  { success: true, data: [{ project_id: <string|null>, count: <number> }, ...] }
 */
router.get('/summary', async (req, res) => {
  try {
    // CORS diagnostics (compatible with permissiveCors applied in app.js)
    try {
      const origin = req.headers?.origin || 'n/a';
      const acao = res.getHeader('Access-Control-Allow-Origin') || 'n/a';
      const acc = res.getHeader('Access-Control-Allow-Credentials') || 'n/a';
      // eslint-disable-next-line no-console
      console.log(`[CORS][GET project-create summary] origin=${origin} ACAO=${acao} ACC=${acc}`);
    } catch {}

    // Resolve organization/tenant
    const q = req.query || {};
    const organization_id = (q.organization_id || q.tenant_id || req.organizationId || req.tenantId || '').toString().trim();
    const isBypass =
      req.tenantScopeDisabled ||
      req.allTenants ||
      (organization_id && organization_id.toUpperCase() === 'T0000');

    if (!isBypass && !organization_id) {
      return res.status(400).json({ success: false, message: 'organization_id (or tenant_id) is required' });
    }

    // Build match for tenant scope
    const match = {};
    if (!isBypass && organization_id) {
      match.$or = [
        { tenant_id: organization_id },
        { organization_id: organization_id },
        { organizationId: organization_id },
        { tenantId: organization_id },
        { orgId: organization_id },
        { 'tenant.tenant_id': organization_id },
      ];
    }

    // Prefer native driver when available via app context
    const db = req.app && typeof req.app.get === 'function' ? req.app.get('db') : null;

    const pipeline = [
      Object.keys(match).length ? { $match: match } : null,
      // ensure we have a stable projection field for grouping
      { $project: { project_id: { $ifNull: ['$project_id', null] } } },
      { $group: { _id: '$project_id', count: { $sum: 1 } } },
      { $project: { _id: 0, project_id: '$_id', count: 1 } },
      { $sort: { count: -1, project_id: 1 } },
    ].filter(Boolean);

    let results;
    if (db && typeof db.collection === 'function') {
      results = await db.collection('session_tracking').aggregate(pipeline, { allowDiskUse: true }).toArray();
    } else {
      results = await SessionTracking.aggregate(pipeline).allowDiskUse(true);
    }

    return res.status(200).json({ success: true, data: results || [] });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[project-create.summary] error:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
