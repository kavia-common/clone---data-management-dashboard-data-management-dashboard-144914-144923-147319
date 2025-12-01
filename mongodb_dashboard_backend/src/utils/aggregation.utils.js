'use strict';

/**
 * PUBLIC_INTERFACE
 * logSlowQuery
 * Logs a warning when a DB operation exceeds the given threshold.
 * @param {number} startedAtMs epoch ms when the operation started
 * @param {number} thresholdMs threshold to consider slow (default 1000ms)
 * @param {object} meta arbitrary metadata to include in the log
 */
function logSlowQuery(startedAtMs, thresholdMs = 1000, meta = {}) {
  try {
    const dur = Date.now() - Number(startedAtMs || 0);
    if (dur >= thresholdMs) {
      // eslint-disable-next-line no-console
      console.warn('[slow-query]', { ms: dur, ...meta });
    }
  } catch (_) {
    // ignore
  }
}

module.exports = { logSlowQuery };
