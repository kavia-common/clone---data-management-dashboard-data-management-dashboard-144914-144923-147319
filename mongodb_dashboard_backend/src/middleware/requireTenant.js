'use strict';

/**
 * PUBLIC_INTERFACE
 * requireTenant middleware enforces that req.auth.tenantId exists.
 * - If missing auth: 401
 * - If missing tenant in auth: 403
 */
function requireTenant(req, res, next) {
  if (!req.auth) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  if (!req.auth.tenantId) {
    return res.status(403).json({ success: false, message: 'No tenant in token' });
  }
  return next();
}

module.exports = { requireTenant };
