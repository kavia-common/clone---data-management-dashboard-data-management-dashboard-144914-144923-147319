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
const fs = require('fs');

const DEV = (process.env.NODE_ENV || '').toLowerCase() !== 'production';

// Consistent error helper
function sendError(res, code, message) {
  return res.status(code).json({ success: false, message });
}

// Internal: normalize roles from multiple claim shapes
function normalizeRoles(claims) {
  const raw = claims?.roles || claims?.role || claims?.['cognito:groups'] || [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

// Internal: pick token from header, cookie, or session
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
  } catch { /* ignore */ }

  // fallback to session if configured
  try {
    if (req.session && typeof req.session.id_token === 'string' && req.session.id_token) {
      return req.session.id_token;
    }
  } catch { /* ignore */ }

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

// Resolve verification strategy: RS256 if public key present; else HS256 with secret
function getVerifyConfig() {
  const pubKey = process.env.JWT_PUBLIC_KEY || '';
  const pubKeyPath = process.env.JWT_PUBLIC_KEY_FILE || '';
  let publicKey = pubKey;
  if (!publicKey && pubKeyPath) {
    try {
      publicKey = fs.readFileSync(pubKeyPath, 'utf8');
    } catch { /* ignore */ }
  }

  const hsSecret = process.env.JWT_SECRET || process.env.JWT_HS256_SECRET || (DEV ? 'dev-secret' : null);
  const expectedAud = process.env.COGNITO_AUDIENCE || process.env.JWT_AUDIENCE;
  const expectedIss = process.env.COGNITO_ISSUER || process.env.JWT_ISSUER;

  if (publicKey && publicKey.includes('BEGIN PUBLIC KEY')) {
    return { algs: ['RS256', 'RS512'], key: publicKey, options: { audience: expectedAud, issuer: expectedIss } };
  }
  return { algs: ['HS256', 'HS512'], key: hsSecret, options: { audience: expectedAud, issuer: expectedIss } };
}

// PUBLIC_INTERFACE
function verifyAndDecode(token) {
  /** Verify JWT. Prefer RS256 public key when configured; fallback to HS256 secret. */
  const { algs, key, options } = getVerifyConfig();
  if (!key) {
    return { decoded: null, error: new Error('JWT verification key/secret not configured') };
  }
  const opts = {};
  if (options?.audience) opts.audience = options.audience;
  if (options?.issuer) opts.issuer = options.issuer;

  try {
    const decoded = jwt.verify(token, key, { algorithms: algs, ...opts });
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
    return sendError(res, 401, 'Missing Authorization token');
  }

  const { decoded, error } = verifyAndDecode(token);
  if (error || !decoded) {
    return sendError(res, 401, 'Invalid or expired token');
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
    return sendError(res, 403, 'Tenant not found in token');
  }

  // If session exists, sync session.tenant_id for convenience
  try {
    if (req.session) {
      req.session.tenant_id = tenantId;
    }
  } catch { /* ignore */ }

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
