/**
 * Clamp a number to [min, max], falling back to defaultVal when not finite.
 */
function clampNumber(n, min, max, defaultVal) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v)) return defaultVal;
  return Math.min(Math.max(v, min), max);
}

/**
 * PUBLIC_INTERFACE
 * parsePagination
 * Coerces page and limit with safe defaults and clamps.
 * - page: default 1, min 1
 * - limit: default 10, min 1, max SERVER_CAP (env: PAGE_LIMIT_MAX default 100)
 * - explicit: true if page or limit explicitly provided
 */
function parsePagination(query) {
  const PAGE_DEFAULT = clampNumber(process.env.PAGE_DEFAULT, 1, 1_000_000, 1);
  const LIMIT_DEFAULT = clampNumber(process.env.LIMIT_DEFAULT, 1, 1_000_000, 10);
  const LIMIT_CAP = clampNumber(process.env.PAGE_LIMIT_MAX, 1, 10_000, 100);

  // Explicit pagination is considered requested only if page or limit are present in the query.
  let explicit =
    Object.prototype.hasOwnProperty.call(query, 'page') ||
    Object.prototype.hasOwnProperty.call(query, 'limit');

  // Treat empty string values as undefined
  const rawPage = (typeof query.page === 'string' && query.page.trim() === '') ? undefined : query.page;
  const rawLimit = (typeof query.limit === 'string' && query.limit.trim() === '') ? undefined : query.limit;

  const page = clampNumber(rawPage, 1, 1_000_000, PAGE_DEFAULT);
  const limit = Math.min(clampNumber(rawLimit, 1, 10_000, LIMIT_DEFAULT), LIMIT_CAP);
  const skip = (page - 1) * limit;

  return { page, limit, skip, explicit, cap: LIMIT_CAP };
}

/**
 * PUBLIC_INTERFACE
 * normalizeQueryQ
 * Returns q or undefined when blank/whitespace; trims strings.
 */
function normalizeQueryQ(q) {
  if (typeof q !== 'string') return undefined;
  const t = q.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * PUBLIC_INTERFACE
 * success
 * Success responder with envelope and traceId included.
 * Prefer not to use this for raw arrays when pagination isn't requested.
 */
function success(req, res, data, meta = undefined, status = 200) {
  const payload = { success: true, data, traceId: req.traceId || null };
  if (meta) payload.meta = meta;
  return res.status(status).json(payload);
}

/**
 * PUBLIC_INTERFACE
 * failure
 * Failure responder with unified error envelope and traceId.
 */
function failure(req, res, message, status = 400, details = undefined, code = 'BAD_REQUEST') {
  const payload = { success: false, code, message, traceId: req.traceId || null };
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

module.exports = { parsePagination, normalizeQueryQ, success, failure, asyncHandler };
