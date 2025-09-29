const { verifyToken } = require('../services/auth');

function extractToken(req) {
  const auth = req.headers.authorization || '';
  const [scheme, token] = auth.split(' ');
  if (scheme && /^Bearer$/i.test(scheme) && token) {
    return token;
  }
  return null;
}

// PUBLIC_INTERFACE
function requireAuth(req, res, next) {
  /** Require a valid Bearer token in Authorization header and attach user to request. */
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const payload = verifyToken(token);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

module.exports = { requireAuth };
