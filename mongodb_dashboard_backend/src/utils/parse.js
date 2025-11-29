'use strict';

/**
 * PUBLIC_INTERFACE
 * parseJSONSafe
 * Safely parse a JSON string, returning a fallback value instead of throwing.
 * @param {string} str - The JSON string to parse.
 * @param {any} fallback - The value to return on failure (default {}).
 * @returns {any} Parsed object or fallback value.
 */
function parseJSONSafe(str, fallback = {}) {
  try {
    if (typeof str !== 'string') return fallback;
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

module.exports = {
  parseJSONSafe,
};
