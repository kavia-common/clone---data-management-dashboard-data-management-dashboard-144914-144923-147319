'use strict';

const jwt = require('jsonwebtoken');

/**
 * PUBLIC_INTERFACE
 * verifyAuth middleware validates a Bearer token, extracts tenant and user info,
 * and attaches it to req.auth = { sub, email, tenantId, roles, isAdmin, raw }.
 * - Supports Cognito-compatible claims (custom:tenant_id, cognito:groups)
 * - Verifies using JWT_PUBLIC_KEY (RS256) or JWT_SECRET (HS256) from environment variables.
 * - Falls back to x-tenant-id header for tenant scoping if token lacks tenant
 *   (useful for legacy clients or intermediate migration).
 */
function verifyAuth(req, res, next) {
  try {
    const header = req.headers['authorization'] || req.headers['Authorization'];
    if (!header) {
      if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
        // eslint-disable-next-line no-console
        console.debug('[verifyAuth] Missing Authorization header for', req.method, req.originalUrl);
      }
      return res.status(401).json({ success: false, message: 'Missing Authorization header' });
    }
    const parts = header.split(' ');
    const token = parts.length === 2 && /^Bearer$/i.test(parts[0]) ? parts[1] : header;

    const publicKey = process.env.JWT_PUBLIC_KEY;
    const secret = process.env.JWT_SECRET;

    if (!publicKey && !secret) {
      return res.status(500).json({ success: false, message: 'Auth not configured: set JWT_PUBLIC_KEY or JWT_SECRET' });
    }

    const verified = jwt.verify(token, publicKey || secret, {
      algorithms: publicKey ? ['RS256', 'RS384', 'RS512'] : ['HS256', 'HS384', 'HS512'],
      ignoreExpiration: false,
      issuer: process.env.JWT_ISSUER || undefined,
      audience: process.env.JWT_AUDIENCE || undefined,
    });

    const claims = verified || {};
    let tenantId =
      claims['custom:tenant_id'] ||
      claims['tenant_id'] ||
      claims['tenantId'] ||
      (Array.isArray(claims['cognito:groups'])
        ? (claims['cognito:groups'].find((g) => typeof g === 'string' && g.startsWith('tenant:')) || '').split(':')[1]
        : null) ||
      null;

    // Fallback: allow x-tenant-id header to populate tenant if claim missing
    if (!tenantId) {
      const hdrTenant = (req.headers['x-tenant-id'] || req.headers['x-tenant'] || '').toString().trim();
      if (hdrTenant) {
        tenantId = hdrTenant;
      } else if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
        // eslint-disable-next-line no-console
        console.debug('[verifyAuth] tenantId unresolved from token and header for', req.method, req.originalUrl);
      }
    }

    const sub = claims.sub || claims.user_id || claims.userId || null;
    const email = claims.email || claims['cognito:username'] || null;

    let roles = [];
    const rawRoles = claims['roles'] || claims['cognito:groups'] || claims['groups'] || [];
    if (Array.isArray(rawRoles)) {
      roles = rawRoles;
    } else if (typeof rawRoles === 'string') {
      roles = rawRoles.split(/[,\s]+/).map((r) => r.trim()).filter(Boolean);
    }

    req.auth = {
      sub,
      email,
      tenantId,
      roles,
      isAdmin: roles.includes('admin') || roles.includes('administrator'),
      raw: claims,
    };
    return next();
  } catch (err) {
    if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
      // eslint-disable-next-line no-console
      console.debug('[verifyAuth] Token verification failed:', err?.message);
    }
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

module.exports = { verifyAuth };
