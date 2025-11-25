'use strict';

/**
// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-BE-ERR-STD-001
// User Story: As a frontend app, I need consistent JSON responses and proper status codes so I can handle errors gracefully.
// Acceptance Criteria:
//  - 404 returns JSON with message and traceId
//  - 4xx/5xx errors return standardized envelope: { success:false, code, message, traceId, details? }
//  - Add audit log for each request outcome with timestamp and optional userId.
// GxP Impact: YES - Ensures legible, accurate, contemporaneous audit logs and standardized validation handling.
// Risk Level: MEDIUM
// Validation Protocol: VP-BE-ERR-STD-001
// ============================================================================
// IMPORTS AND DEPENDENCIES
// ============================================================================
 */
const { randomUUID } = require('crypto');

// PUBLIC_INTERFACE
function auditLoggerMiddleware() {
  /**
   * GxP audit middleware: logs request start and completion with outcome.
   * Captures: method, path, userId (if available), timestamp, status.
   * In production, replace console with a persistent audit sink.
   */
  return function auditLogger(req, res, next) {
    const start = Date.now();
    // Generate a trace id for correlation across handlers
    const traceId = randomUUID();
    req.traceId = traceId;

    // Extract user id if available (placeholder: req.user?.id from auth layer)
    const userId = (req.user && (req.user.id || req.user.userId)) || null;

    // Log start
     
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        type: 'AUDIT',
        phase: 'START',
        traceId,
        method: req.method,
        path: req.originalUrl,
        userId,
        ip: req.ip,
      })
    );

    res.on('finish', () => {
       
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          type: 'AUDIT',
          phase: 'END',
          traceId,
          method: req.method,
          path: req.originalUrl,
          userId,
          status: res.statusCode,
          durationMs: Date.now() - start,
        })
      );
    });

    return next();
  };
}

// PUBLIC_INTERFACE
function notFoundHandler(req, res) {
  /**
   * 404 handler returning standardized JSON.
   */
  const payload = {
    success: false,
    code: 'NOT_FOUND',
    message: 'Not Found',
    path: req.originalUrl,
    traceId: req.traceId || null,
  };
  return res.status(404).json(payload);
}

// PUBLIC_INTERFACE
function errorHandler(err, req, res, next) {
  /**
   * Central error handler producing a standardized JSON envelope.
   * Maps validation errors to 422, cast errors to 400, DB connectivity to 503,
   * and defaults to 500. Logs stack traces in non-production.
   */
  const env = String(process.env.NODE_ENV || '').toLowerCase();

  // Prefer detailed logging during development/test
   
  if (env !== 'production') {
    console.error('[ERROR]', err?.stack || err);
  } else {
    console.error('[ERROR]', err?.message || err);
  }

  let status = err.status || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'Internal Server Error';
  let details;

  // Mongoose cast errors or similar -> 400
  if (err?.name === 'CastError' || /cast to/i.test(err?.message || '')) {
    status = 400;
    code = 'BAD_REQUEST';
    message = 'Invalid value provided';
    details = err.message;
  }

  // Connectivity/network issues -> 503
  const errName = String(err?.name || '');
  const errMsg = String(err?.message || '');
  if (
    errName.includes('MongoNetworkError') ||
    /ECONNREFUSED/i.test(errMsg) ||
    /failed to connect/i.test(errMsg)
  ) {
    status = 503;
    code = 'SERVICE_UNAVAILABLE';
    message = 'Database unavailable';
  }

  // Validation semantic -> 422
  if (status === 422 || /validation/i.test(errMsg)) {
    status = 422;
    code = 'UNPROCESSABLE_ENTITY';
  }

  const payload = {
    success: false,
    code,
    message,
    traceId: req.traceId || null,
  };
  if (details) {payload.details = details;}

  return res.status(status).json(payload);
}

module.exports = {
  auditLoggerMiddleware,
  notFoundHandler,
  errorHandler,
};
