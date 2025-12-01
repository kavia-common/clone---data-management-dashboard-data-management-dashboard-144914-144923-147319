'use strict';

const { isDBReadyFast } = require('../config/db');

/**
 * PUBLIC_INTERFACE
 * Express middleware that checks DB readiness within <=1s.
 * If not ready, responds 503 with JSON body and sets diagnostic headers.
 */
async function dbReadyOr503(req, res, next) {
  try {
    const readiness = await isDBReadyFast(1000);
    if (!readiness.ok) {
      res.setHeader('X-DB-Connected', 'false');
      res.setHeader('X-Org-Filter', String(req.headers['x-organization-id'] || req.query.organization_id || req.query.tenant_id || ''));
      return res.status(503).json({
        success: false,
        error: 'Database not ready',
        detail: readiness.reason || 'unknown',
        hint: !process.env.MONGODB_URI ? 'Set MONGODB_URI (and optional MONGODB_DB)' : undefined
      });
    }
    return next();
  } catch (e) {
    return res.status(503).json({ success: false, error: 'Database readiness check failed' });
  }
}

module.exports = { dbReadyOr503 };
