'use strict';

/**
// PUBLIC_INTERFACE
 * parseCurrencyToNumber
 * Safely parses a currency-like value to a number.
 * - Accepts inputs like "$0.447605", "1,234.567890", 0.123, "  $ 12.34  ".
 * - Strips "$", commas, and whitespace.
 * - Returns a finite number or 0 if parsing fails.
 * @param {any} value
 * @returns {number}
 */
function parseCurrencyToNumber(value) {
  try {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }
    if (value == null) return 0;
    const s = String(value).trim();
    if (!s) return 0;
    // Remove $ and commas and spaces
    const sanitized = s.replace(/\$/g, '').replace(/,/g, '').trim();
    const n = Number.parseFloat(sanitized);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
// PUBLIC_INTERFACE
 * roundTo
 * Rounds a number to the specified precision, default 6 decimals.
 * Returns 0 if not a finite number.
 * @param {number} n
 * @param {number} precision
 * @returns {number}
 */
function roundTo(n, precision = 6) {
  if (!Number.isFinite(n)) return 0;
  const p = Math.max(0, Math.min(20, precision));
  const f = Math.pow(10, p);
  return Math.round(n * f) / f;
}

module.exports = {
  parseCurrencyToNumber,
  roundTo,
};
