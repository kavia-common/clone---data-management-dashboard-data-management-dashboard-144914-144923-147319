function parsePagination(query) {
  // Explicit pagination is considered requested only if page or limit are present in the query.
  const explicit =
    Object.prototype.hasOwnProperty.call(query, 'page') ||
    Object.prototype.hasOwnProperty.call(query, 'limit');

  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 200);
  const skip = (page - 1) * limit;
  return { page, limit, skip, explicit };
}

/**
 * Success responder (legacy envelope).
 * Prefer not to use this for raw data when pagination isn't requested.
 */
function success(res, data, meta = undefined, status = 200) {
  const payload = { success: true, data };
  if (meta) payload.meta = meta;
  return res.status(status).json(payload);
}

/**
 * Failure responder with unified error envelope.
 * Kept as envelope for clarity on errors.
 */
function failure(res, message, status = 400, details = undefined) {
  const payload = { success: false, message };
  if (details) payload.details = details;
  return res.status(status).json(payload);
}

// PUBLIC_INTERFACE
function asyncHandler(fn) {
  /** Wrap an async route handler and forward errors to Express. */
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { parsePagination, success, failure, asyncHandler };
