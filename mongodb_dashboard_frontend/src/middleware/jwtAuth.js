'use strict';

/**
 * JWT verification and tenant extraction helpers.
 * Supports:
 *  - AWS Cognito style tokens (tenant in "custom:tenant_id" or "tenant_id")
 *  - Generic OIDC/JWT with HS256 fallback using JWT_SECRET
 *  - Optional audience/issuer verification via env
 * 
 * Environment variables:
 * - JWT_SECRET: HS256 HMAC secret (fallback when JWKS is not configured)
 * - COGNITO_AUDIENCE or JWT_AUDIENCE: expected audience (optional)
 * - COGNITO_ISSUER or JWT_ISSUER: expected issuer (optional)
 */

const jwt = require('jsonwebtoken');

const DEV = process.env.NODE_ENV !== 'production';

// Normalize Authorization header Bearer token
function getTokenFromHeader(req) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader) return null;
  const [scheme, token] = String(authHeader).split(' ');
  if (!/^Bearer$/i.test(scheme) || !token) return null;
  return token;
}

// PUBLIC_INTERFACE
function verifyAndDecode(token) {
  /** Verify and decode JWT using configured strategy (HS256 fallback).
   * Returns { decoded, error } where decoded is the JWT payload object.
   */
  const secret = process.env.JWT_SECRET;
  const expectedAud = process.env.COGNITO_AUDIENCE || process.env.JWT_AUDIENCE;
  const expectedIss = process.env.COGNITO_ISSUER || process.env.JWT_ISSUER;

  try {
    const options = {};
    if (expectedAud) options.audience = expectedAud;
    if (expectedIss) options.issuer = expectedIss;

    // For this project we use HS256 fallback. If needed, RS256/JWKS can be added later.
    const decoded = jwt.verify(token, secret || 'dev-secret', options);
    return { decoded, error: null };
  } catch (err) {
    return { decoded: null, error: err };
  }
}

// Extract tenantId from common claim locations
function extractTenantIdFromClaims(claims) {
  if (!claims || typeof claims !== 'object') return null;
  // Cognito custom attribute
  const cognitoCustom = claims['custom:tenant_id'];
  // Generic/local claim naming
  const plain = claims.tenant_id || claims.tenantId || claims.organization_id || claims.orgId;
  return cognitoCustom || plain || null;
}

// PUBLIC_INTERFACE
function attachAuthToRequest(req, claims) {
  /** Populate req.auth with normalized auth fields for downstream middleware and controllers. */
  req.auth = req.auth || {};
  req.auth.sub = claims.sub || claims.user_id || claims.id || null;
  req.auth.email = claims.email || null;

  const tenantId = extractTenantIdFromClaims(claims);
  req.auth.tenantId = tenantId || null;

  // Roles/RBAC
  const roles = claims['cognito:groups'] || claims.roles || claims.role || [];
  req.auth.roles = Array.isArray(roles) ? roles : (typeof roles === 'string' ? roles.split(',').map(s => s.trim()) : []);

  if (DEV) {
    // Minimal debug logging in development only
    // eslint-disable-next-line no-console
    console.debug('[auth] tenantId:', req.auth.tenantId, 'sub:', req.auth.sub, 'roles:', req.auth.roles);
  }
}

module.exports = {
  getTokenFromHeader,
  verifyAndDecode,
  attachAuthToRequest,
};
