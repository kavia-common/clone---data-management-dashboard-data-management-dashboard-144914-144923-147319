'use strict';

/**
 * PUBLIC_INTERFACE
 * JWT verification and tenant extraction middleware/utilities.
 *
 * Summary/Usage:
 * - Use verifyTenantAccess on protected routes: router.use(verifyAuth, requireTenant)
 * - Token source: strictly Authorization: Bearer <token> (cookies tolerated if present but not required)
 * - HS256 verification with JWT_SECRET (fallback to 'dev-secret' in non-production)
 * - Optional issuer/audience checks via JWT_ISSUER/JWT_AUDIENCE or COGNITO_ISSUER/COGNITO_AUDIENCE
 * - Tenant claim normalization: custom:tenant_id OR tenant_id OR tenantId OR organization_id
 * - Attaches req.user (claims), req.token (raw), req.auth = { sub, email, roles[], tenantId }, req.tenantId
 */

const jwt = require('jsonwebtoken');

const DEV = (process.env.NODE_ENV || '').toLowerCase() !== 'production';

// Internal: normalize roles from multiple claim shapes
function normalizeRoles(claims) {
  const raw = claims?.roles || claims?.role || claims?.['cognito:groups'] || [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

// Internal: pick token from header; tolerate cookie if present but do not require it
function getToken(req) {
  const hdr = req.headers?.authorization || req.headers?.Authorization;
  if (hdr && typeof hdr === 'string') {
    const [scheme, token] = hdr.split(' ');
    if (/^Bearer$/i.test(scheme) && token) return token.trim();
  }
  // tolerate presence of cookie if clients send it; do not require
  try {
    if (req.cookies && typeof req.cookies.id_token === 'string' && req.cookies.id_token) {
      return req.cookies.id_token;
    }
  } catch {
    // ignore when cookie-parser is not mounted
  }
  return null;
}

// PUBLIC_INTERFACE
function extractTenantIdFromClaims(claims) {
  /**
   * Extract tenant id from common claims.
   * Normalization order: custom:tenant_id -> tenant_id -> 'tenant_id' -> tenantId -> organization_id
   */
  if (!claims || typeof claims !== 'object') return null;
  return (
    claims['custom:tenant_id'] ||
    claims.tenant_id ||
    claims['tenant_id'] ||
    claims.tenantId ||
    claims.organization_id ||
    null
  );
}

// PUBLIC_INTERFACE
function verifyAndDecode(token) {
  /**
   * Verify JWT with HS256. Optional iss/aud checks if configured.
   * Uses JWT_SECRET (or JWT_HS256_SECRET) and allows 'dev-secret' in non-production.
   */
  const secret = process.env.JWT_SECRET || process.env.JWT_HS256_SECRET || (DEV ? 'dev-secret' : null);
  if (!secret) {
    return { decoded: null, error: new Error('JWT secret not configured') };
  }
  const expectedAud = process.env.COGNITO_AUDIENCE || process.env.JWT_AUDIENCE;
  const expectedIss = process.env.COGNITO_ISSUER || process.env.JWT_ISSUER;

  const options = {};
  if (expectedAud) options.audience = expectedAud;
  if (expectedIss) options.issuer = expectedIss;

  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'], ...options });
    return { decoded, error: null };
  } catch (err) {
    return { decoded: null, error: err };
  }
}

// PUBLIC_INTERFACE
function verifyTenantAccess(req, res, next) {
  /**
   * Express middleware that strictly requires Authorization: Bearer <token>.
   * On success attaches normalized auth context and requires tenant to be present in claims.
   */
  const token = getToken(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Missing Authorization: Bearer token' });
  }

  const { decoded, error } = verifyAndDecode(token);
  if (error || !decoded) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }

  // Attach req.user and normalized req.auth
  req.user = decoded;
  req.token = token;

  const sub = decoded.sub || decoded.user_id || decoded.id || null;
  const email = decoded.email || null;
  const roles = normalizeRoles(decoded);
  const tenantId = extractTenantIdFromClaims(decoded);

  req.auth = { sub, email, roles, tenantId };
  req.tenantId = tenantId;

  if (!tenantId) {
    return res.status(403).json({ success: false, message: 'Tenant not found in token' });
  }

  return next();
}

// PUBLIC_INTERFACE
function applyTenantFilter(queryOrCriteria = {}, tenantId) {
  /**
   * Merge tenant_id constraint into Mongo or Mongoose find criteria.
   * - For plain objects: returns a new object with tenant_id merged (enforced equality).
   * - For Mongoose Query instances: mutates by adding where('tenant_id').equals(tenantId) and returns the query.
   */
  if (!tenantId) return queryOrCriteria;

  // Mongoose Query support (duck typing: has where() and equals())
  if (queryOrCriteria && typeof queryOrCriteria.where === 'function') {
    return queryOrCriteria.where('tenant_id').equals(tenantId);
  }

  // Plain criteria object
  const merged = { ...(queryOrCriteria || {}) };
  merged.tenant_id = tenantId;
  return merged;
}

// PUBLIC_INTERFACE
function withTenantMatch(pipeline = [], tenantId) {
  /**
   * Ensure first aggregation stage matches tenant_id; replace existing first-stage $match on tenant_id if present.
   */
  const head = { $match: { tenant_id: tenantId } };
  if (Array.isArray(pipeline) && pipeline.length > 0) {
    const first = pipeline[0];
    if (first && typeof first === 'object' && first.$match && Object.prototype.hasOwnProperty.call(first.$match, 'tenant_id')) {
      return [head, ...pipeline.slice(1)];
    }
  }
  return [head, ...(pipeline || [])];
}

module.exports = {
  verifyTenantAccess,
  applyTenantFilter,
  withTenantMatch,
  extractTenantIdFromClaims,
  verifyAndDecode,
};
