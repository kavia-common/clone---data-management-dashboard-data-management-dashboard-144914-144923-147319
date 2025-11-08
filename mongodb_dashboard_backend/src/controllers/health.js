'use strict';

/**
 * PUBLIC_INTERFACE
 * check
 * Lightweight health handler that does not require DB connectivity.
 * Returns 200 with simple payload for readiness checks.
 */
function check(req, res) {
  /** This endpoint is DB-independent and safe for container probes. */
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
