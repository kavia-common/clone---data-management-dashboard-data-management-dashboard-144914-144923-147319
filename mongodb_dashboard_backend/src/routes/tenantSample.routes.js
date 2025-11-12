'use strict';

const express = require('express');
const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * Sample tenant-scoped demo endpoint.
 */
router.get('/sample/tenant', (req, res) => {
  const tenantId = (req.auth && req.auth.tenantId) || req.headers['x-tenant-id'] || 'demo-tenant';
  res.status(200).json({ success: true, tenant_id: String(tenantId) });
});

module.exports = router;
