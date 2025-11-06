'use strict';

const { getTokenFromHeader, verifyAndDecode, attachAuthToRequest } = require('./jwtAuth');

/**
 * verifyAuth middleware
 * - Validates Authorization: Bearer token
 * - Decodes and verifies JWT
 * - Populates req.auth and req.user for downstream usage
 */
// PUBLIC_INTERFACE
function verifyAuth(req, res, next) {
  const token = getTokenFromHeader(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Missing Authorization header' });
  }

  const { decoded, error } = verifyAndDecode(token);
  if (error || !decoded) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }

  // Attach commonly used fields
  attachAuthToRequest(req, decoded);
  req.user = decoded; // backward compat

  next();
}

module.exports = { verifyAuth };
