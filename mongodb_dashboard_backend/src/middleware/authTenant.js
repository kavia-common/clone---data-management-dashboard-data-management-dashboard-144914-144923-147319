'use strict';

const jwt = require('jsonwebtoken');

/**
 * PUBLIC_INTERFACE
 * Middleware to authenticate requests using a Bearer JWT and attach user/tenant context.
 * - Parses Authorization: Bearer <token>
 * - Verifies JWT using process.env.JWT_SECRET (falls back to a local dev secret)
 * - Extracts user id and tenant_id from token payload (supports several common field names)
 * - Attaches req.auth = { userId, tenantId, token }
 * - On failure: 401 (missing/invalid) or 403 (forbidden usage)
 */
function authTenant(req, res, next) {
  const hdr = req.headers['authorization'] || req.headers['Authorization'];
  if (!hdr) {
    return res.status(401).json({ error: 'Authorization header missing' });
  }
  const parts = hdr.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'Invalid Authorization header format. Expected: Bearer <token>' });
  }
  const token = parts[1];
  const secret = process.env.JWT_SECRET || 'dev-local-jwt-secret-change-me';

  try {
    const payload = jwt.verify(token, secret);

    // Accept multiple field aliases for robustness
    const userId =
      payload.userId ||
      payload.user_id ||
      payload.sub ||
      payload.uid;

    const tenantId =
      payload.tenantId ||
      payload.tenant_id ||
      payload.organization_id ||
      payload.orgId;

    if (!userId || !tenantId) {
      return res.status(403).json({ error: 'Token missing required claims: userId and tenantId' });
    }

    req.auth = { userId: String(userId), tenantId: String(tenantId), token };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * PUBLIC_INTERFACE
 * Guard middleware that ensures any :tenantId path param matches the authenticated tenant.
 * Returns 403 if mismatch.
 */
function ensureTenantAccess(req, res, next) {
  const pathTenant = req.params?.tenantId || req.params?.tenant_id;
  if (!pathTenant) {return next();}
  const authTenantId = req.auth?.tenantId;
  if (!authTenantId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (String(pathTenant) !== String(authTenantId)) {
    return res.status(403).json({ error: 'Forbidden: tenant mismatch' });
  }
  return next();
}

/**
 * PUBLIC_INTERFACE
 * Helper to apply tenant filter to a Mongo query or filter object.
 * - If `modelOrQuery` is a plain object, ensures it includes { tenant_id: tenantId } (without overwriting if already present).
 * - If it is a Mongoose query (has .where or .find), chains a where('tenant_id').equals(tenantId) only when not already applied.
 */
function applyTenantFilter(modelOrQuery, tenantId) {
  // If tenantId is missing, force a filter that matches nothing to avoid cross-tenant leakage.
  const NO_TENANT_SENTINEL = '__NO_TENANT__';

  if (!tenantId) {
    // For plain filters
    if (modelOrQuery && typeof modelOrQuery === 'object' && !isMongooseQuery(modelOrQuery)) {
      return { ...(modelOrQuery || {}), tenant_id: NO_TENANT_SENTINEL };
    }
    // For mongoose queries
    if (isMongooseQuery(modelOrQuery)) {
      try {
        modelOrQuery.where('tenant_id').equals(NO_TENANT_SENTINEL);
      } catch (_) {
        // ignore
      }
      return modelOrQuery;
    }
    return modelOrQuery;
  }

  // If it's a plain object (filter)
  if (modelOrQuery && typeof modelOrQuery === 'object' && !isMongooseQuery(modelOrQuery)) {
    if (!('tenant_id' in modelOrQuery)) {
      return { ...modelOrQuery, tenant_id: tenantId };
    }
    return modelOrQuery;
  }

  // If it's a mongoose query
  if (isMongooseQuery(modelOrQuery)) {
    // Attempt to avoid duplicate filters if already specified
    try {
      const _conditions = modelOrQuery.getQuery ? modelOrQuery.getQuery() : {};
      if (!('tenant_id' in _conditions)) {
        modelOrQuery.where('tenant_id').equals(tenantId);
      }
    } catch (_) {
      // best-effort; if we can't read internal query, just chain the filter
      modelOrQuery.where('tenant_id').equals(tenantId);
    }
  }

  return modelOrQuery;
}

function isMongooseQuery(obj) {
  return !!obj && typeof obj === 'object' && (typeof obj.where === 'function' || typeof obj.find === 'function');
}

module.exports = {
  authTenant,
  ensureTenantAccess,
  applyTenantFilter,
};