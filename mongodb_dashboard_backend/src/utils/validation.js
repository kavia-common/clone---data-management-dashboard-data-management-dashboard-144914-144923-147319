'use strict';

// PUBLIC_INTERFACE
function parseJSONSafe(input, fallback = null) {
  /** Safely parse JSON strings. Returns fallback when parsing fails or input is falsy. */
  if (!input || typeof input !== 'string') return fallback;
  try {
    return JSON.parse(input);
  } catch (_e) {
    return fallback;
  }
}

module.exports = {
  parseJSONSafe
};
