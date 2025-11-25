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
 * - Extract tenant_id/tenantId from JWT payload and attach as req.auth.tenantId (normalized).
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
      try {
         
        console.warn('[auth] JWT secret not set; using demo token behavior for development.');
      } catch {}
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
    if (process.env.JWT_ISSUER) {verifyOptions.issuer = process.env.JWT_ISSUER;}
    if (process.env.JWT_AUDIENCE) {verifyOptions.audience = process.env.JWT_AUDIENCE;}

    const payload = jwt.verify(token, secret || '', verifyOptions);

    // Normalize req.auth to guarantee presence of sub and tenantId
    // IMPORTANT: Do not allow header to override tenant_id when token is present
    const tenantFromHeader = req.headers['x-tenant-id'] || req.headers['x-tenant'];
    const allTenantsHeader = String(req.headers['x-all-tenants'] || '').toLowerCase().trim();
    const allTenantsQuery = String(req.query?.all_tenants || '').toLowerCase().trim();
    const wantsAllTenants = ['1','true','yes','on'].includes(allTenantsHeader) || ['1','true','yes','on'].includes(allTenantsQuery);

    // Robust tenantId extraction:
    // - Support common names: tenantId, tenant_id, organization_id, orgId
    // - Support namespaced claims like 'https://example.com/tenantId' or 'custom:tenantId'
    let extractedTenantId =
      payload.tenantId ||
      payload.tenant_id ||
      payload.organization_id ||
      payload.orgId ||
      null;

    if (!extractedTenantId && payload && typeof payload === 'object') {
      for (const [k, v] of Object.entries(payload)) {
        if (typeof v === 'string') {
          const nk = k.toLowerCase();
          if (
            nk.endsWith('/tenantid') ||
            nk.endsWith(':tenantid') ||
            nk.endsWith('/tenant_id') ||
            nk.endsWith(':tenant_id')
          ) {
            extractedTenantId = v;
            break;
          }
        }
      }
    }

    req.auth = {
      ...payload,
      sub: payload.sub || payload.user_id || payload.userId || payload.id || 'user',
      tenantId: extractedTenantId || (process.env.AUTH_DEFAULT_TENANT || 'DEMO'),
      scope: payload.scope || payload.scp || [],
      roles: Array.isArray(payload.roles)
        ? payload.roles
        : (payload.role ? [payload.role] : (Array.isArray(payload['https://roles']) ? payload['https://roles'] : [])),
      demo: false,
      _tenantHeader: tenantFromHeader || null,
    };

    // If Super Admin and all-tenants requested, set flags on req (not on auth)
    try {
      const rolesArr = Array.isArray(req.auth.roles) ? req.auth.roles : [];
      const isSA = rolesArr.map((r) => String(r).toLowerCase()).includes('super admin');
      if (isSA && wantsAllTenants) {
        req.tenantScopeDisabled = true;
        req.allTenants = true;
      }
    } catch {}

    // Dev-only concise logs: computed tenant and subject for troubleshooting
    try {
      if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
         
        console.debug('[verifyAuth] sub=', req.auth.sub, 'tenantId=', req.auth.tenantId);
      }
    } catch {}

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

const verifyAuthApi = { verifyAuth };
module.exports = { ...verifyAuthApi, default: verifyAuthApi };