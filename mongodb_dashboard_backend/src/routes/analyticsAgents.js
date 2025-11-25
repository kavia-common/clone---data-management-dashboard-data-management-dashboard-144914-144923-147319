'use strict';

const express = require('express');
const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * Minimal agents analytics route placeholder
 * GET /api/analytics/agents
 */
router.get('/', (req, res) => {
  try {
    const hdr = (req.headers?.['x-organization-id'] || '').toString();
    const qOrg = (req.query?.organization_id || req.query?.tenant_id || '').toString();
    const requestedTenant = hdr || qOrg || '';
    const isT0000 = requestedTenant && requestedTenant.toUpperCase() === 'T0000';
    if (isT0000) { try { res.set('X-All-Tenants', 'true'); } catch (_) {} }
    console.log('[analyticsAgents.routes] bypass check', { requestedTenant, isT0000 });
  } catch (_) {}
  res.status(200).json({ items: [], total: 0, meta: { limit: 50, offset: 0 } });
});

module.exports = router;
