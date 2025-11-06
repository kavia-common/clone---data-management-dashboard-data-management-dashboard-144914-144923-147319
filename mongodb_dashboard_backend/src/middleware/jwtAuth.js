'use strict';

/**
 * JWT verification and tenant extraction middleware/utilities.
 *
 * Behavior:
 * - Reads token from Authorization: Bearer <token> or cookie "id_token"
 * - Verifies JWT using HS256 with JWT_SECRET (fallback to 'dev-secret' in non-production to ease local testing)
 * - Optionally enforces issuer and audience when JWT_ISSUER/JWT_AUDIENCE (or COGNITO_* variants) are provided
 * - Extracts tenant id from one of:
 *      - claims['custom:tenant_id']
 *      - claims.tenant_id
 *      - claims['tenant_id']
 *      - claims.tenantId
 *      - claims.organization_id (fallback)
 * - On success:
 *      - req.user = decoded
 *      - req.auth = { sub, email, roles[], tenantId }
 *      - req.tenantId = tenantId
 *      - req.token = raw token
 * - On failure: responds 401 with a safe message
 *
 * PUBLIC INTERFACES:
 *  - verifyTenantAccess (Express middleware)
 *  - applyTenantFilter (for Mongo/Mongoose queries)
 *  - withTenantMatch (for aggregation pipelines; ensures $match { tenant_id } is first)
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

// Internal: pick token from header or cookie
function getToken(req) {
  const hdr = req.headers?.authorization || req.headers?.Authorization;
  if (hdr && typeof hdr === 'string') {
    const [scheme, token] = hdr.split(' ');
    if (/^Bearer$/i.test(scheme) && token) return token.trim();
  }
  // fallback to cookie named id_token if present
  try {
    if (req.cookies && typeof req.cookies.id_token === 'string' && req.cookies.id_token) {
      return req.cookies.id_token;
    }
  } catch {
    // ignore cookies if cookie-parser is not mounted
  }
  return null;
}

// PUBLIC_INTERFACE
function extractTenantIdFromClaims(claims) {
  /** Extract tenant id from common claims. */
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
  /** Verify JWT with HS256. Optional iss/aud checks if configured. */
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
  /** Express middleware that verifies token and attaches normalized auth context. */
  const token = getToken(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Missing Authorization token' });
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
   * - For plain objects: returns a new object with tenant_id merged.
   * - For Mongoose Query instances: mutates by adding where('tenant_id').equals(tenantId) and returns the query.
   */
  if (!tenantId) return queryOrCriteria;

  // Mongoose Query support (duck typing: has where() and equals())
  if (queryOrCriteria && typeof queryOrCriteria.where === 'function') {
    return queryOrCriteria.where('tenant_id').equals(tenantId);
  }

  // Plain criteria object
  const merged = { ...(queryOrCriteria || {}) };
  if (Object.prototype.hasOwnProperty.call(merged, 'tenant_id')) {
    merged.tenant_id = tenantId;
  } else {
    merged.tenant_id = tenantId;
  }
  return merged;
}

// PUBLIC_INTERFACE
function withTenantMatch(pipeline = [], tenantId) {
  /** Ensure first pipeline stage matches tenant_id; replace existing first-stage $match on tenant_id if present. */
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
