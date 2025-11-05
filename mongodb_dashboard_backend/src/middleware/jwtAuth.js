'use strict';

const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { getJwtSecretConfig } = require('../config/auth');

/**
// PUBLIC_INTERFACE
 * getAuthVerifier
 * Creates a verifier that validates JWTs using either:
 * - JWKS URL (preferred if AUTH_JWKS_URL is set)
 * - HMAC secret (AUTH_JWT_SECRET) for HS256
 * - Dev fallback: decode without signature when ALLOW_INSECURE_JWT_DECODE='true'
 *
 * The verifier extracts minimal user context and normalizes claims:
 * - sub -> id
 * - email
 * - tenant -> tenant_id (or organization_id)
 * - scope/roles -> is_admin flag when available
 */
function getAuthVerifier() {
  const jwksUrl = process.env.AUTH_JWKS_URL || process.env.COGNITO_JWKS_URL || '';
  const { secret, isMissing } = getJwtSecretConfig();
  const allowInsecureDecode = String(process.env.ALLOW_INSECURE_JWT_DECODE || '').toLowerCase() === 'true';
  let client = null;

  if (jwksUrl) {
    client = jwksClient({
      jwksUri: jwksUrl,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 10 * 60 * 1000,
      requestHeaders: {}, // can add auth if required by provider
      timeout: 7000,
    });
  }

  async function getKey(header, cb) {
    if (!client || header.alg && header.alg.startsWith('HS')) {
      // For HS*, use local secret
      return cb(null, secret || '');
    }
    try {
      client.getSigningKey(header.kid, (err, key) => {
        if (err) return cb(err);
        const signingKey = key.getPublicKey();
        return cb(null, signingKey);
      });
    } catch (e) {
      return cb(e);
    }
  }

  function normalizeUserFromClaims(claims) {
    const id = claims.sub || claims.user_id || claims.uid || null;
    const email = claims.email || claims['custom:email'] || null;
    const tenantClaim = claims.tenant_id || claims.tenant || claims.organization_id || claims.org_id || null;
    const roles = Array.isArray(claims.roles)
      ? claims.roles
      : typeof claims.scope === 'string'
        ? claims.scope.split(' ').filter(Boolean)
        : [];
    const is_admin = roles.includes('admin') || roles.includes('superadmin') || claims.is_admin === true;
    return {
      id,
      email,
      tenant_id: tenantClaim || null,
      is_admin,
      roles: roles.length ? roles : undefined,
      claims,
    };
  }

  async function verifyToken(token) {
    if (!token) {
      const err = new Error('Missing token');
      err.statusCode = 401;
      throw err;
    }

    // JWKS verification (preferred)
    if (client) {
      const opts = {
        algorithms: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'],
        ignoreExpiration: false,
      };
      return new Promise((resolve, reject) => {
        jwt.verify(token, getKey, opts, (err, decoded) => {
          if (err) return reject(err);
          const user = normalizeUserFromClaims(decoded || {});
          resolve({ decoded, user, source: 'jwks' });
        });
      });
    }

    // HMAC secret verification
    if (!isMissing && secret) {
      try {
        const decoded = jwt.verify(token, secret, { algorithms: ['HS256', 'HS384', 'HS512'] });
        const user = normalizeUserFromClaims(decoded || {});
        return { decoded, user, source: 'secret' };
      } catch (e) {
        // continue to fallback if allowed
        if (!allowInsecureDecode) {
          e.statusCode = 401;
          throw e;
        }
      }
    }

    // Dev fallback: decode without signature
    if (allowInsecureDecode) {
      const decoded = jwt.decode(token) || {};
      const user = normalizeUserFromClaims(decoded);
      return { decoded, user, source: 'insecure-decode' };
    }

    const err = new Error('No verification method configured');
    err.statusCode = 401;
    throw err;
  }

  return { verifyToken };
}

/**
 * Extract bearer token from Authorization header
 */
function getBearerToken(req) {
  const h = req.headers?.authorization || '';
  const [type, val] = h.split(' ');
  if (type && /^Bearer$/i.test(type) && val) return val.trim();
  return null;
}

// PUBLIC_INTERFACE
function bearerAuthAttach() {
  /**
   * Middleware that requires Authorization bearer token, validates it,
   * and attaches req.user and req.user.tenant_id from token claims.
   */
  const { verifyToken } = getAuthVerifier();
  return async function (req, res, next) {
    try {
      const token = getBearerToken(req);
      if (!token) {
        return res.status(401).json({ success: false, message: 'Authorization header missing' });
      }
      const { user } = await verifyToken(token);

      if (!user || !user.id) {
        return res.status(401).json({ success: false, message: 'Invalid token (no subject)' });
      }
      req.user = {
        ...req.user,
        id: user.id,
        email: user.email || req.user?.email || null,
        roles: user.roles || req.user?.roles,
        is_admin: user.is_admin || false,
        tenants: req.user?.tenants, // preserve if already loaded elsewhere
        tenant_id: user.tenant_id || req.user?.tenant_id || null,
        claims: user.claims,
      };
      return next();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[jwtAuth] verify failed:', e?.message || e);
      const status = e.statusCode || 401;
      return res.status(status).json({ success: false, message: 'Unauthorized' });
    }
  };
}

// PUBLIC_INTERFACE
function optionalBearerAuthAttach() {
  /**
   * Middleware that tries to attach req.user if a token is present,
   * but does not reject on failure.
   */
  const { verifyToken } = getAuthVerifier();
  return async function (req, res, next) {
    try {
      const token = getBearerToken(req);
      if (!token) return next();
      const { user } = await verifyToken(token);
      req.user = {
        ...req.user,
        id: user.id || req.user?.id || null,
        email: user.email || req.user?.email || null,
        roles: user.roles || req.user?.roles,
        is_admin: user.is_admin || false,
        tenants: req.user?.tenants,
        tenant_id: user.tenant_id || req.user?.tenant_id || null,
        claims: user.claims,
      };
    } catch (e) {
      // ignore errors, proceed as unauthenticated
    }
    return next();
  };
}

module.exports = {
  getAuthVerifier,
  bearerAuthAttach,
  optionalBearerAuthAttach,
};
