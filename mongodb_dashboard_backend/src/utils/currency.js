 /**
  * PUBLIC_INTERFACE
  * parseCurrencyToNumber
  * Parses currency-like strings to a number; strips $ and commas.
  *
  * @param {string|number|null|undefined} value
  * @returns {number} Parsed number or 0 on failure
  */
function parseCurrencyToNumber(value) {
  try {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }
    if (value === null || value === undefined) {
      return 0;
    }
    const s = String(value).trim();
    if (!s) {
      return 0;
    }
    const sanitized = s.replace(/\$/g, '').replace(/,/g, '').trim();
    const n = Number.parseFloat(sanitized);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * PUBLIC_INTERFACE
 * roundTo
 * Round a number safely to a given precision (default 6).
 *
 * @param {number} n
 * @param {number} [precision=6]
 * @returns {number}
 */
function roundTo(n, precision = 6) {
  if (!Number.isFinite(n)) {
    return 0;
  }
  const p = Math.max(0, Math.min(20, precision));
  const f = Math.pow(10, p);
  return Math.round(n * f) / f;
}

const currencyUtil = {
  parseCurrencyToNumber,
  roundTo,
};

module.exports = {
  parseCurrencyToNumber,
  roundTo,
  currencyUtil,
};
