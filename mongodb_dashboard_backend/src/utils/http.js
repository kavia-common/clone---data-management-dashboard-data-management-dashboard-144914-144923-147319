'use strict';

/**
 * PUBLIC_INTERFACE
 * parsePagination
 * Parses pagination params from query with sane defaults.
 */
function parsePagination(query) {
  const explicit =
    Object.prototype.hasOwnProperty.call(query, 'page') ||
    Object.prototype.hasOwnProperty.call(query, 'limit');

  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 500);
  const skip = (page - 1) * limit;
  return { page, limit, skip, explicit };
}

/**
 * PUBLIC_INTERFACE
 * success
 * Success responder with legacy envelope { success, data, meta? }.
 */
function success(res, data, meta = undefined, status = 200) {
  const payload = { success: true, data };
  if (meta) {payload.meta = meta;}
  return res.status(status).json(payload);
}

/**
 * PUBLIC_INTERFACE
 * failure
 * Failure responder with envelope { success: false, message, details? }.
 */
function failure(res, message, status = 400, details = undefined) {
  const payload = { success: false, message };
  if (details) {payload.details = details;}
  return res.status(status).json(payload);
}

/**
 * PUBLIC_INTERFACE
 * asyncHandler
 * Wrap an async route handler and forward errors to Express.
 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const httpUtil = { parsePagination, success, failure, asyncHandler };
module.exports = httpUtil;
