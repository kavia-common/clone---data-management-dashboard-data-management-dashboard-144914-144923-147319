'use strict';

/**
 * PUBLIC_INTERFACE
 * verifyAuth
 * Minimal JWT auth middleware placeholder.
 * - If Authorization header is present, attaches a minimal req.auth.
 * - If missing, still allows request through (routes may protect additionally).
 * This keeps the server bootable without external auth setup.
 */
function verifyAuth(req, res, next) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  // Very lightweight simulation: if any bearer token present, set a default tenant
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    // In a real app, decode/verify token and set claims accordingly.
    req.auth = req.auth || {};
    req.auth.token = token;
    req.auth.tenantId = req.auth.tenantId || req.headers['x-tenant-id'] || req.headers['x-tenant'] || 'demo-tenant';
    req.auth.roles = req.auth.roles || ['member'];
  }
  return next();
}

module.exports = { verifyAuth };
