'use strict';

const jwt = require('jsonwebtoken');

/**
 * PUBLIC_INTERFACE
 * verifyAuth
 * Express middleware to verify Authorization Bearer tokens for protected routes.
 * Rules:
 * - /health, /api/health, /openapi.json, /api-docs(.json), /docs must remain PUBLIC (not guarded here).
 * - Missing Authorization header should return 401 JSON, not crash.
 * - If JWT secret is missing:
 *    - In production: reject with 401 (do not crash startup).
 *    - In non-production: allow demo mode only when ALLOW_DEMO_AUTH=true or token === "ok".
 * - If token === "ok" in non-production and demo allowed, fabricate a minimal auth context.
 */
function verifyAuth(req, res, next) {
  try {
    // Public endpoints bypass (defense in depth; app.js mounts Swagger/health before this)
    const p = req.path || req.originalUrl || '';
    if (
      p === '/' ||
      p.startsWith('/health') ||
      p.startsWith('/api/health') ||
      p.startsWith('/openapi.json') ||
      p.startsWith('/api-docs') ||
      p.startsWith('/docs')
    ) {
      return next();
    }

    const rawHeader = req.headers.authorization || req.headers.Authorization || '';
    const header = String(rawHeader || '').trim();
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : (header || '');

    const secret = process.env.JWT_SECRET || process.env.JWT_HS256_SECRET || '';
    const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    const allowDemoFlag = String(process.env.ALLOW_DEMO_AUTH || '').toLowerCase() === 'true';

    // Missing token -> 401 (graceful)
    if (!token) {
      if (!isProd && allowDemoFlag) {
        // Only fabricate when explicitly allowed (previews)
        req.auth = {
          sub: 'demo-user',
          email: 'demo@example.com',
          tenantId:
            req.headers['x-tenant-id'] ||
            req.headers['x-tenant'] ||
            (process.env.AUTH_DEFAULT_TENANT || 'DEMO'),
          demo: true,
          scope: ['read'],
        };
        return next();
      }
      return res.status(401).json({ success: false, message: 'Unauthorized: missing token' });
    }

    // Explicit dev token
    if (!secret && !isProd && (allowDemoFlag || token === 'ok')) {
      req.auth = {
        sub: token === 'ok' ? 'ok-user' : 'demo-user',
        email: token === 'ok' ? 'ok@example.com' : 'demo@example.com',
        tenantId:
          req.headers['x-tenant-id'] ||
          req.headers['x-tenant'] ||
          (process.env.AUTH_DEFAULT_TENANT || 'DEMO'),
        demo: true,
        scope: ['read', 'write'],
      };
      return next();
    }

    if (!secret && isProd) {
      // Do not throw; respond with 401 so startup doesn't crash.
      return res.status(401).json({ success: false, message: 'Unauthorized: auth not configured' });
    }

    // Verify JWT using configured secret
    const verifyOptions = {
      algorithms: [(process.env.JWT_ALG || 'HS256')],
    };
    if (process.env.JWT_ISSUER) verifyOptions.issuer = process.env.JWT_ISSUER;
    if (process.env.JWT_AUDIENCE) verifyOptions.audience = process.env.JWT_AUDIENCE;

    const payload = jwt.verify(token, secret || '', verifyOptions);

    // Normalize req.auth
    const tenantFromHeader = req.headers['x-tenant-id'] || req.headers['x-tenant'];
    req.auth = {
      ...payload,
      sub: payload.sub || payload.user_id || payload.userId || payload.id || 'user',
      tenantId:
        payload.tenantId ||
        payload.tenant_id ||
        tenantFromHeader ||
        (process.env.AUTH_DEFAULT_TENANT || 'DEMO'),
      scope: payload.scope || payload.scp || [],
      demo: false,
    };

    return next();
  } catch (err) {
    const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    const allowDemoFlag = String(process.env.ALLOW_DEMO_AUTH || '').toLowerCase() === 'true';
    if (!isProd && allowDemoFlag) {
      req.auth = {
        sub: 'demo-fallback',
        tenantId:
          req.headers['x-tenant-id'] ||
          req.headers['x-tenant'] ||
          (process.env.AUTH_DEFAULT_TENANT || 'DEMO'),
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
