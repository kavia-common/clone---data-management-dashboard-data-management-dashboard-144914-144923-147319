'use strict';

/**
 * PUBLIC_INTERFACE
 * parsePagination
 * Parses pagination params from query with sane defaults.
 * - Caps limit to <= 50 by default (hard cap 1000).
 * - If limit missing, uses default 20 for envelope path and 50 for non-enveloped list safety.
 */
function parsePagination(query) {
  const explicit =
    Object.prototype.hasOwnProperty.call(query, 'page') ||
    Object.prototype.hasOwnProperty.call(query, 'limit');

  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  // Default to 20 when explicitly paginating, else 50 as safe non-explicit page size
  const defaultLimit = explicit ? 20 : 50;
  // Absolute maximum guardrail 1000, but typical endpoints will further clamp lower
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), 1000);
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

/**
 * PUBLIC_INTERFACE
 * withRequestTimeout
 * Runs an async function with a timeout; on timeout, returns { timedOut: true, partial? }.
 * Intended for controller-local guardrails to avoid 504s.
 */
async function withRequestTimeout(promiseOrFn, { ms = 900, onTimeout = null } = {}) {
  const isFn = typeof promiseOrFn === 'function';
  let taskPromise;
  try {
    taskPromise = isFn ? Promise.resolve().then(() => promiseOrFn()) : Promise.resolve(promiseOrFn);
  } catch (e) {
    return { timedOut: false, error: e };
  }
  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(async () => {
      try {
        const partial = onTimeout ? await onTimeout() : undefined;
        resolve({ timedOut: true, partial });
      } catch {
        resolve({ timedOut: true, partial: undefined });
      }
    }, ms);
  });

  const result = await Promise.race([taskPromise.then((v) => ({ timedOut: false, value: v })).catch((e) => ({ timedOut: false, error: e })), timeoutPromise]);
  clearTimeout(timer);
  return result;
}

const httpUtil = { parsePagination, success, failure, asyncHandler, withRequestTimeout };
module.exports = httpUtil;
