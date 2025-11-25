'use strict';

/**
 * PUBLIC_INTERFACE
 * Cognito/JWKS aware auth middleware.
 * - Verifies Authorization: Bearer <token> (or req.query.id_token / req.body.id_token as fallback) using JWKS when configured.
 * - Extracts sub, email, and custom:tenant_id (also accepts tenant_id/tenantId).
 * - Attaches req.user = { sub, email } and req.tenantId.
 * - Dev fallback: if JWKS not configured, will decode without verification to allow local testing.
 *
 * Environment variables:
 *   COGNITO_JWKS_URL     - URL to JWKS endpoint (preferred verification mode)
 *   COGNITO_ISSUER       - Optional expected issuer for verification
 *   COGNITO_AUDIENCE     - Optional expected audience for verification
 *   AUTH_DEFAULT_TENANT  - Default tenant used in fallback mode when tenant is not present
 *   ALLOW_DEMO_AUTH      - 'true' enables permissive dev behavior if verification not possible
 */

const jwt = require('jsonwebtoken');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

/**
 * Fetch JSON helper with simple in-memory cache to avoid frequent JWKS pulls.
 */
const jwksCache = {
  keys: null,
  fetchedAt: 0,
  maxAgeMs: 5 * 60 * 1000, // 5 minutes
};

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client
      .get(url, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject)
      .end();
  });
}

/**
 * Get JWKS (cached).
 */
async function getJwks() {
  const url = process.env.COGNITO_JWKS_URL || process.env.JWKS_URL || '';
  if (!url) {
    return null;
  }
  const now = Date.now();
  if (jwksCache.keys && now - jwksCache.fetchedAt < jwksCache.maxAgeMs) {
    return jwksCache.keys;
  }
  const json = await fetchJson(url);
  if (!json || !Array.isArray(json.keys)) {return null;}
  jwksCache.keys = json.keys;
  jwksCache.fetchedAt = now;
  return jwksCache.keys;
}

/**
 * Convert JWK to PEM (supports RSA).
 */
function jwkToPem(jwk) {
  if (!jwk || jwk.kty !== 'RSA') {return null;}
  const exponent = Buffer.from(jwk.e, 'base64');
  const modulus = Buffer.from(jwk.n, 'base64');
  // Build RSA public key in ASN.1 DER, then to PEM.
  // Minimal implementation using Node crypto KeyObject from JWK when available (Node 15+).
  try {
    const keyObject = crypto.createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
    const pem = keyObject.export({ type: 'spki', format: 'pem' });
    return pem.toString();
  } catch (e) {
    return null;
  }
}

/**
 * Locate PEM by kid from JWKS.
 */
async function getPemForKid(kid) {
  const keys = await getJwks();
  if (!keys) {return null;}
  const jwk = keys.find((k) => k.kid === kid);
  if (!jwk) {return null;}
  return jwkToPem(jwk);
}

/**
 * Extract bearer token or id_token from request.
 */
function extractToken(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  if (typeof h === 'string' && h.startsWith('Bearer ')) {
    return h.slice(7).trim();
  }
  // Fallback for integrations that pass id_token in body or query
  if (req.body?.id_token && typeof req.body.id_token === 'string') {return req.body.id_token;}
  if (req.query?.id_token && typeof req.query.id_token === 'string') {return req.query.id_token;}
  return null;
}

/**
 * Attempt verified decode using JWKS; falls back to unverified decode if JWKS is missing and dev mode is allowed.
 */
async function verifyOrDecodeToken(token) {
  const jwksUrl = process.env.COGNITO_JWKS_URL || process.env.JWKS_URL || '';
  const issuer = process.env.COGNITO_ISSUER || process.env.JWT_ISSUER;
  const audience = process.env.COGNITO_AUDIENCE || process.env.JWT_AUDIENCE;

  if (jwksUrl) {
    // Header read for kid
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64').toString('utf8'));
    const kid = header.kid;
    const alg = header.alg;
    const pem = await getPemForKid(kid);
    if (!pem) {
      throw new Error('JWKS key not found for kid');
    }
    const opts = { algorithms: [alg || 'RS256'] };
    if (issuer) {opts.issuer = issuer;}
    if (audience) {opts.audience = audience;}
    const verified = jwt.verify(token, pem, opts);
    return { payload: verified, verified: true };
  }

  // No JWKS configured -> dev fallback
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const allowDemo = String(process.env.ALLOW_DEMO_AUTH || '').toLowerCase() === 'true';
  if (!isProd && allowDemo) {
    try {
      const payload = jwt.decode(token) || {};
      return { payload, verified: false };
    } catch {
      return { payload: {}, verified: false };
    }
  }

  throw new Error('Auth not configured');
}

/**
 * Normalize tenant from payload and headers.
 */
function resolveTenantId(req, payload) {
  return (
    payload?.['custom:tenant_id'] ||
    payload?.tenant_id ||
    payload?.tenantId ||
    req.headers?.['x-tenant-id'] ||
    req.headers?.['x-tenant'] ||
    process.env.AUTH_DEFAULT_TENANT ||
    null
  );
}

/**
 * PUBLIC_INTERFACE
 * cognitoAuthMiddleware
 * Express middleware that attaches req.user and req.tenantId after token verification/decoding.
 */
function cognitoAuthMiddleware(req, res, next) {
  (async () => {
    try {
      const token = extractToken(req);
      if (!token) {
        return res.status(401).json({ success: false, message: 'Unauthorized: missing token' });
      }
      const { payload, verified } = await verifyOrDecodeToken(token);

      const sub = payload?.sub || payload?.user_id || payload?.id || null;
      const email = payload?.email || payload?.user_email || null;
      const tenantId = resolveTenantId(req, payload);

      if (!sub || !tenantId) {
        return res.status(401).json({ success: false, message: 'Unauthorized: token missing subject or tenant' });
      }

      req.user = { sub, email, token_verified: verified };
      req.tenantId = tenantId;
      // Maintain compatibility with existing code that uses req.auth.*
      req.auth = {
        ...(req.auth || {}),
        sub,
        email,
        tenantId,
        verified,
        token_use: payload?.token_use,
      };

      return next();
    } catch (err) {
      const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
      const allowDemo = String(process.env.ALLOW_DEMO_AUTH || '').toLowerCase() === 'true';
      if (!isProd && allowDemo) {
        // very permissive local fallback
        const fallbackTenant = req.headers?.['x-tenant-id'] || req.headers?.['x-tenant'] || process.env.AUTH_DEFAULT_TENANT || 'DEMO';
        req.user = { sub: 'dev-user', email: 'dev@example.com', token_verified: false };
        req.tenantId = fallbackTenant;
        req.auth = { sub: 'dev-user', email: 'dev@example.com', tenantId: fallbackTenant, verified: false, demo: true };
        return next();
      }
      return res.status(401).json({ success: false, message: 'Unauthorized: invalid token' });
    }
  })();
}

module.exports = {
  cognitoAuthMiddleware,
};