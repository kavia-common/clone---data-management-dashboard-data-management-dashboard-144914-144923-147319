'use strict';

const jwt = require('jsonwebtoken');

/**
 * PUBLIC_INTERFACE
 * verifyAuth middleware validates a Bearer token, extracts tenant and user info,
 * and attaches it to req.auth = { userId, tenantId, roles, isAdmin, rawClaims }.
 *
 * Behavior:
 * - Accepts Authorization: Bearer <token>
 * - Verifies using JWT_PUBLIC_KEY or JWT_SECRET from environment variables.
 * - Extracts tenant from one of: custom:tenant_id, tenant_id, tenantId
 * - Extracts user id from one of: sub, user_id, userId
 * - Extracts roles from one of: roles (array|string, comma separated), 'cognito:groups'
 * - Sets isAdmin if roles includes 'admin'
 * - On invalid/missing token: 401
 *
 * Note: This demo uses HS/RS verification based on available envs. For production,
 * prefer JWKS-based verification for providers like Cognito/Auth0.
 */
function verifyAuth(req, res, next) {
  try {
    const authz = req.headers['authorization'] || req.headers['Authorization'];
    if (!authz || !authz.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Missing Authorization header' });
    }
    const token = authz.slice('Bearer '.length).trim();
    const publicKey = process.env.JWT_PUBLIC_KEY;
    const secret = process.env.JWT_SECRET;

    if (!publicKey && !secret) {
      return res.status(500).json({ success: false, message: 'Auth not configured: missing JWT_PUBLIC_KEY / JWT_SECRET' });
    }

    // Prefer public key verification, fallback to shared secret
    const verified = jwt.verify(token, publicKey || secret, {
      algorithms: publicKey ? ['RS256', 'RS384', 'RS512'] : ['HS256', 'HS384', 'HS512'],
      ignoreExpiration: false,
    });

    // Normalize claims
    const claims = verified || {};
    const tenantId =
      claims['custom:tenant_id'] ||
      claims['tenant_id'] ||
      claims['tenantId'] ||
      null;

    const userId = claims['sub'] || claims['user_id'] || claims['userId'] || null;

    let roles = [];
    const rawRoles = claims['roles'] || claims['cognito:groups'] || claims['groups'] || [];
    if (Array.isArray(rawRoles)) {
      roles = rawRoles;
    } else if (typeof rawRoles === 'string') {
      roles = rawRoles.split(',').map((r) => r.trim()).filter(Boolean);
    }

    const isAdmin = roles.includes('admin') || roles.includes('administrator');

    req.auth = {
      userId,
      tenantId,
      roles,
      isAdmin,
      rawClaims: claims,
      tokenUse: claims['token_use'] || claims['typ'] || null,
    };

    return next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token', error: err && err.message });
  }
}

module.exports = { verifyAuth };
