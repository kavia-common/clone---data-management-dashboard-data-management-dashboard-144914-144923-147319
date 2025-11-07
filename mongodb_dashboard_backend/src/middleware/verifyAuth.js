'use strict';

const jwt = require('jsonwebtoken');

/**
 * PUBLIC_INTERFACE
 * verifyAuth
 * Express middleware to verify Authorization Bearer tokens.
 * Behavior:
 * - If JWT secret is configured (JWT_SECRET or JWT_HS256_SECRET), verify token and set req.auth.
 * - If secret is not configured:
 *    - In production: reject with 401 Unauthorized.
 *    - In non-production: allow a permissive "demo" mode only when ALLOW_DEMO_AUTH=true,
 *      or when token equals "ok", and populate a minimal req.auth so protected routes work.
 * - Also supports a simple opaque "ok" token for preview/dev to keep the backend booting.
 *
 * Environment:
 * - JWT_SECRET / JWT_HS256_SECRET: HS256 secret to verify tokens
 * - JWT_ISSUER / JWT_AUDIENCE: optional verify constraints
 * - ALLOW_DEMO_AUTH=true: enables permissive path when secret is missing (non-production)
 */
function verifyAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    const token = (String(authHeader).startsWith('Bearer ') ? String(authHeader).slice(7) : String(authHeader)).trim();

    // Resolve secret and environment
    const secret = process.env.JWT_SECRET || process.env.JWT_HS256_SECRET || '';
    const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    const allowDemo = String(process.env.ALLOW_DEMO_AUTH || '').toLowerCase() === 'true' || (!isProd && !secret);

    // No token case
    if (!token) {
      if (allowDemo) {
        // Demo mode: fabricate a basic auth context to avoid blocking protected routes in preview
        req.auth = {
          sub: 'demo-user',
          email: 'demo@example.com',
          tenantId: req.headers['x-tenant-id'] || req.headers['x-tenant'] || (process.env.AUTH_DEFAULT_TENANT || 'DEMO'),
          demo: true,
          scope: ['read'],
        };
        return next();
      }
      return res.status(401).json({ success: false, message: 'Unauthorized: missing token' });
    }

    // Opaque "ok" token support for preview/dev
    if (!secret && allowDemo && token === 'ok') {
      req.auth = {
        sub: 'ok-user',
        email: 'ok@example.com',
        tenantId: req.headers['x-tenant-id'] || req.headers['x-tenant'] || (process.env.AUTH_DEFAULT_TENANT || 'DEMO'),
        demo: true,
        scope: ['read', 'write'],
      };
      return next();
    }

    // If secret is missing in production, reject
    if (!secret && isProd) {
      return res.status(401).json({ success: false, message: 'Unauthorized: auth not configured' });
    }

    // Verify JWT when secret is present
    const verifyOptions = {
      algorithms: [(process.env.JWT_ALG || 'HS256')],
    };
    if (process.env.JWT_ISSUER) verifyOptions.issuer = process.env.JWT_ISSUER;
    if (process.env.JWT_AUDIENCE) verifyOptions.audience = process.env.JWT_AUDIENCE;

    const payload = jwt.verify(token, secret || ''); // secret required when verifying
    // Normalize minimal req.auth fields
    req.auth = {
      ...payload,
      sub: payload.sub || payload.user_id || payload.userId || payload.id || 'user',
      tenantId:
        payload.tenantId ||
        payload.tenant_id ||
        req.headers['x-tenant-id'] ||
        req.headers['x-tenant'] ||
        (process.env.AUTH_DEFAULT_TENANT || 'DEMO'),
      scope: payload.scope || payload.scp || [],
      demo: false,
    };

    return next();
  } catch (err) {
    // In non-production, optionally allow pass-through when ALLOW_DEMO_AUTH=true
    const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    const allowDemo = String(process.env.ALLOW_DEMO_AUTH || '').toLowerCase() === 'true';
    if (!isProd && allowDemo) {
      req.auth = {
        sub: 'demo-fallback',
        tenantId: req.headers['x-tenant-id'] || req.headers['x-tenant'] || (process.env.AUTH_DEFAULT_TENANT || 'DEMO'),
        demo: true,
        scope: ['read'],
        error: 'jwt_verify_failed',
      };
      return next();
    }
    return res.status(401).json({ success: false, message: 'Unauthorized: invalid token' });
  }
}

module.exports = { verifyAuth };
