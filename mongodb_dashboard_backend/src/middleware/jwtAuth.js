'use strict';

/**
 * JWT verification middleware with Cognito-compatible claims extraction.
 * - Verifies tokens using RS256 against JWKS (well-known or configured URL)
 * - Validates issuer and audience if configured
 * - Extracts tenant ID from custom:tenant_id (Cognito convention) or tenant_id fallback
 * - Sets req.auth = { sub, email, tenantId, raw, scopes }
 *
 * Environment variables required (documented for orchestrator to set in .env):
 * - JWT_JWKS_URI: URL to JWKS (e.g., https://cognito-idp.<region>.amazonaws.com/<userPoolId>/.well-known/jwks.json)
 * - JWT_ISSUER: expected issuer (e.g., https://cognito-idp.<region>.amazonaws.com/<userPoolId>)
 * - JWT_AUDIENCE: expected audience/client_id
 * - JWT_HEADER: header to read (default Authorization)
 * - JWT_SCHEME: scheme prefix (default Bearer)
 */

const jwksClient = require('jwks-rsa');
const jwt = require('jsonwebtoken');

const JWKS_URI = process.env.JWT_JWKS_URI || '';
const EXPECT_ISS = process.env.JWT_ISSUER || '';
const EXPECT_AUD = process.env.JWT_AUDIENCE || '';
const HEADER_NAME = (process.env.JWT_HEADER || 'authorization').toLowerCase();
const SCHEME = (process.env.JWT_SCHEME || 'bearer').toLowerCase();

// Initialize JWKS client if configured
const client = JWKS_URI
  ? jwksClient({
      jwksUri: JWKS_URI,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 10 * 60 * 1000, // 10 min
      timeout: 10000,
    })
  : null;

async function getKey(header, callback) {
  if (!client) {
    return callback(new Error('JWKS client not configured'));
  }
  if (!header || !header.kid) {
    return callback(new Error('Token header missing kid'));
  }
  try {
    const key = await client.getSigningKey(header.kid);
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  } catch (err) {
    callback(err);
  }
}

// PUBLIC_INTERFACE
function verifyAuth(options = {}) {
  /**
   * Express middleware to verify JWT and attach req.auth.
   * Returns 401 on failure.
   */
  return function jwtVerifyMiddleware(req, res, next) {
    try {
      const headerVal = (req.headers[HEADER_NAME] || '').toString();
      if (!headerVal) {
        return res.status(401).json({ success: false, message: 'Missing Authorization header' });
      }
      const parts = headerVal.split(' ');
      const hasScheme = parts.length === 2 && parts[0].toLowerCase() === SCHEME;
      const token = hasScheme ? parts[1] : headerVal;

      const verifyOpts = {
        algorithms: ['RS256', 'HS256'], // allow HS256 only if HMAC secret provided
        issuer: EXPECT_ISS || undefined,
        audience: EXPECT_AUD || undefined,
      };

      // When JWKS configured, use RS256 verifier; else fallback to HMAC secret if present
      const HMAC_SECRET = process.env.JWT_HS256_SECRET;

      const onVerified = (err, decoded) => {
        if (err || !decoded) {
          return res.status(401).json({ success: false, message: 'Invalid token' });
        }
        // Cognito custom attributes often appear as "custom:tenant_id"
        const tenantId =
          decoded['custom:tenant_id'] ||
          decoded.tenant_id ||
          decoded.tenantId ||
          (decoded['cognito:groups'] && Array.isArray(decoded['cognito:groups'])
            ? decoded['cognito:groups'].find((g) => g.startsWith('tenant:'))?.split(':')[1]
            : undefined);

        req.auth = {
          sub: decoded.sub || decoded.user_id || decoded.id,
          email: decoded.email || decoded['cognito:username'] || null,
          tenantId: tenantId || null,
          raw: decoded,
          scopes: decoded.scope ? decoded.scope.split(' ') : decoded.scopes || [],
        };
        return next();
      };

      if (client) {
        // Verify with JWKS public keys
        jwt.verify(token, getKey, verifyOpts, onVerified);
      } else if (HMAC_SECRET) {
        // Verify with HMAC
        jwt.verify(token, HMAC_SECRET, verifyOpts, onVerified);
      } else {
        return res
          .status(500)
          .json({ success: false, message: 'Auth not configured: missing JWKS or HMAC secret' });
      }
    } catch (e) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
  };
}

// PUBLIC_INTERFACE
function requireTenant() {
  /** Ensure req.auth.tenantId exists; else 403 */
  return function (req, res, next) {
    const tenantId = req?.auth?.tenantId;
    if (!tenantId) {
      return res.status(403).json({ success: false, message: 'Tenant not set in token' });
    }
    next();
  };
}

// PUBLIC_INTERFACE
function tenantFilter(baseFilter = {}) {
  /**
   * Return a MongoDB filter merged with tenant enforcement.
   * Usage in controllers/services: const filter = tenantFilter({ status: 'active' })(req);
   */
  return function (req) {
    const tenantId = req?.auth?.tenantId;
    const enforced = tenantId ? { tenant_id: tenantId } : {};
    return { ...baseFilter, ...enforced };
  };
}

module.exports = {
  verifyAuth,
  requireTenant,
  tenantFilter,
};
