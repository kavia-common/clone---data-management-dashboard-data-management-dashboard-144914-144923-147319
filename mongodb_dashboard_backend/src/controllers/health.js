'use strict';

/**
 * PUBLIC_INTERFACE
 * Health controller with fast response that does not depend on DB connectivity.
 * Provides basic uptime/status info for readiness probes.
 */
const os = require('os');

function getBasicStatus() {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    hostname: os.hostname(),
    node: process.version,
    env: process.env.NODE_ENV || 'development',
  };
}

// PUBLIC_INTERFACE
function check(req, res) {
  /** Returns 200 with basic status; safe for readiness checks. */
  res.set('Cache-Control', 'no-store');
  return res.status(200).json(getBasicStatus());
}

module.exports = { check };
