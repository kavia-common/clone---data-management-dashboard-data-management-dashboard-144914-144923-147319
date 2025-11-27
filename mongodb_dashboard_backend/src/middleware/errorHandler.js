'use strict';

/**
 * PUBLIC_INTERFACE
 * Express error handler that returns consistent JSON errors.
 * - If error has status or statusCode uses it, otherwise 500.
 * - Never leaks stack in production, includes stack in non-production for debugging.
 */
function errorHandler(err, req, res, _next) {
  try {
    const status = err.status || err.statusCode || 500;
    const payload = {
      success: false,
      error: err?.message || 'Internal Server Error',
    };
    if (process.env.NODE_ENV !== 'production' && err?.stack) {
      payload.stack = err.stack;
    }
    // Never throw from error handler
    return res.status(status).json(payload);
  } catch {
    try {
      return res.status(500).json({ success: false, error: 'Internal Server Error' });
    } catch {}
  }
}

module.exports = errorHandler;