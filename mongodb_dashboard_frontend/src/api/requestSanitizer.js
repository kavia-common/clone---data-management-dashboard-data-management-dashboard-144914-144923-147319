'use strict';

// PUBLIC_INTERFACE
/**
 * sanitizeRequestParams
 * Removes undefined/null/empty-string query parameters to keep URLs clean.
 * Note: Preserves page=1 and limit values; preserves boolean false and numeric 0.
 */
export function sanitizeRequestParams(params = {}) {
  const out = {};
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    // allow 0 or false; skip empty string
    if (typeof v === 'string' && v.trim() === '') return;
    out[k] = v;
  });
  return out;
}

export default {
  sanitizeRequestParams,
};
