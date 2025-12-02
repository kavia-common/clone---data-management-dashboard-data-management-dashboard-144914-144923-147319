'use strict';

const mongoose = require('mongoose');
const { mongoConnectionManager } = require('../config/db.connectionManager');

/**
 * PUBLIC_INTERFACE
 * dbConnectionGuard
 * Express middleware that short-circuits requests with 503 Service Unavailable when MongoDB is down
 * or not configured (missing MONGODB_URI). Adds structured logs including organization_id when present.
 */
function dbConnectionGuard(req, res, next) {
  // Allow health endpoints to always respond
  const p = req.path || req.originalUrl || '';
  if (p.startsWith('/health') || p.startsWith('/ready') || p.startsWith('/live')) {
    return next();
  }

  // Missing URI -> immediate 503
  if (mongoConnectionManager.isUriMissing()) {
    try {
      console.warn('[dbGuard] MONGODB_URI missing; returning 503');
    } catch {}
    return res.status(503).json({
      success: false,
      error: 'Database not configured',
      message: 'MONGODB_URI is missing. Set environment variable to enable database access.',
    });
  }

  // If not connected, fast-fail. We avoid waiting long here.
  const ready = mongoose.connection?.readyState === 1;
  if (!ready) {
    // include org id in logs if available
    const organization_id =
      req.tenantId ||
      req?.auth?.tenantId ||
      req.headers['x-organization-id'] ||
      req.query?.organization_id ||
      req.query?.tenant_id ||
      null;
    try {
      console.warn('[dbGuard] Database not connected. Short-circuiting request.', {
        organization_id: organization_id ? String(organization_id) : null,
        path: req.originalUrl,
        method: req.method,
      });
    } catch {}
    return res.status(503).json({
      success: false,
      error: 'Service Unavailable',
      message: 'Database is not connected. Please try again shortly.',
    });
  }

  next();
}

module.exports = { dbConnectionGuard };
