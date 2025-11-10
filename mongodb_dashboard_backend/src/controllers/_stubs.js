'use strict';

/**
 * PUBLIC_INTERFACE
 * Minimal stub controllers to avoid startup crashes if referenced controllers are missing.
 * Each handler returns 200 with a { status: 'stub', controller: '<name>' } payload.
 */

function buildStub(name) {
  // PUBLIC_INTERFACE
  return function stubController(req, res) {
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
      status: 'stub',
      controller: name,
      path: req.originalUrl,
      method: req.method,
      time: new Date().toISOString(),
    });
  };
}

// PUBLIC_INTERFACE
const stub = {
  users: buildStub('users'),
  analytics: buildStub('analytics'),
  deployments: buildStub('deployments'),
  counts: buildStub('counts'),
  health: buildStub('health'),
};

module.exports = {
  // PUBLIC_INTERFACE
  buildStub,
  // PUBLIC_INTERFACE
  stub,
};
