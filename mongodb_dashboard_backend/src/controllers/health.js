'use strict';

const mongoose = require('mongoose');

/**
 * PUBLIC_INTERFACE
 * check
 * Health handler used by base router; does not require DB connectivity to return 200.
 * Returns:
 *  - status: "ok"
 *  - db: "connected" | "connecting" | "disconnected"
 *  - timestamp: ISO string
 * This endpoint is safe for readiness/liveness probes.
 */
async function check(req, res) {
  const ready = mongoose.connection.readyState;
  const db = ready === 1 ? 'connected' : ready === 2 ? 'connecting' : 'disconnected';
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({ status: 'ok', db, timestamp: new Date().toISOString() });
}

module.exports = { check };
