'use strict';

const User = require('../models/user.model');
const { deriveDeterministicUserId } = require('../utils/idFromSalt');

// Compute once per process; deterministic across restarts for same salt
const DEFAULT_DERIVED_ID = deriveDeterministicUserId();

/**
// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-BE-AUTH-CTX-001
// User Story: As a system, I need to identify the authenticated user from the Authorization header to enforce RBAC and log audit entries.
// Acceptance Criteria:
//  - Parse Bearer token from Authorization header
//  - Attach req.user with minimally { id, email?, tenants? }
//  - Fail gracefully with 401 if required for protected endpoints
// GxP Impact: YES - Access control and attributable audit logs.
// Risk Level: MEDIUM
// Validation Protocol: VP-BE-AUTH-CTX-001
// ============================================================================
// IMPORTS AND DEPENDENCIES
// ============================================================================
 */

/**
 * Extract Bearer token from request headers.
 */
function getBearerToken(req) {
  const h = req.headers?.authorization || '';
  const parts = h.split(' ');
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) return parts[1];
  return null;
}

/**
 * Attempt to derive a userId/email from simple token patterns for demo/stub auth.
 * Supported formats:
 *  - 'ok' -> demo user id 'demo'
 *  - 'user:<id>' -> id
 *  - 'email:<email>' -> email
 */
function deriveIdentityFromToken(token) {
  if (!token) return {};
  // For demo/stub auth, 'ok' now maps to a deterministic id derived from secret salt
  if (token === 'ok') return { id: DEFAULT_DERIVED_ID };
  if (token.startsWith('user:')) {
    // honor explicit user:<id> tokens; still fallback to deterministic id if missing
    return { id: token.slice('user:'.length) || DEFAULT_DERIVED_ID };
  }
  if (token.startsWith('email:')) {
    return { email: token.slice('email:'.length) || '' };
  }
  // Fallback to deterministic id (no hardcoded/demo id)
  return { id: DEFAULT_DERIVED_ID };
}

/**
 * Load a user document heuristically:
 * - Prefer x-user-id / x-user-email headers if provided (for testing).
 * - Else use derived identity from token.
 * - Fetch from users collection. Schema is strict:false, so tenants can exist.
 */
async function loadUserFromDb({ id, email }, headers) {
  const hdrId = headers['x-user-id'] || headers['x-userid'] || null;
  const hdrEmail = headers['x-user-email'] || headers['x-useremail'] || null;
  const q = {};
  if (hdrId) q._id = hdrId;
  else if (hdrEmail) q.email = hdrEmail;
  else if (id) q._id = id;
  else if (email) q.email = email;

  if (Object.keys(q).length === 0) return null;

  try {
    const doc = await User.findOne(q).lean();
    return doc || null;
  } catch {
    return null;
  }
}

// PUBLIC_INTERFACE
function attachAuthContext() {
  /** Middleware that attaches req.user when a Bearer token is present (best-effort). */
  return async function (req, res, next) {
    try {
      const token = getBearerToken(req);
      if (!token) {
        return next(); // public routes still proceed
      }
      const idCtx = deriveIdentityFromToken(token);
      const dbUser = await loadUserFromDb(idCtx, req.headers);

      // Min shape: id, email and tenants (array) if available
      const user = {
        id: (dbUser && (dbUser._id?.toString?.() || dbUser.id || dbUser.user_id?.toString?.())) || idCtx.id || null,
        email: (dbUser && dbUser.email) || idCtx.email || null,
        tenants: Array.isArray(dbUser?.tenants) ? dbUser.tenants : undefined,
        roles: dbUser?.roles || undefined,
        raw: dbUser || undefined,
      };

      req.user = user;
      return next();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[auth] attachAuthContext error', e);
      return next();
    }
  };
}

// PUBLIC_INTERFACE
function requireAuth() {
  /** Middleware that enforces presence of req.user (i.e., Bearer token provided/recognized). */
  return function (req, res, next) {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }
    return next();
  };
}

module.exports = {
  attachAuthContext,
  requireAuth,
};
