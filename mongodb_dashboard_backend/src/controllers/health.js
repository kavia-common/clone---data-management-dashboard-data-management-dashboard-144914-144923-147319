'use strict';

/**
 * PUBLIC_INTERFACE
 * check
 * Lightweight health handler that does not require DB connectivity or authentication.
 * Returns 200 with a small JSON payload for readiness checks.
 * This handler is used by:
 *  - GET /health        (public)
 *  - GET /api/health    (public)
 */
function check(req, res) {
  return res.status(200).json({
    ok: true,
    status: 'healthy',
    db: !!req.app?.locals?.db,
    timestamp: new Date().toISOString(),
    service: 'mongodb_dashboard_backend',
  });
}

module.exports = {
  check,
};
