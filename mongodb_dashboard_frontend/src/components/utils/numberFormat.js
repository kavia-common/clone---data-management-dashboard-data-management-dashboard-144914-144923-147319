//
// PUBLIC_INTERFACE
// formatUsdUpTo8: Format a number as USD with up to 8 decimal places.
// Avoids trailing zeros by setting minimumFractionDigits to 0 and maximumFractionDigits to 8.
// Ensures negative numbers are rendered with the sign before the currency symbol (e.g., -$1.23).
//
/** PUBLIC_INTERFACE
 * formatUsdUpTo8
 * Formats a number as USD with up to 8 decimal places. Trailing zeros are not forced.
 * Example:
 *  - formatUsdUpTo8(1.23456789) => "$1.23456789"
 *  - formatUsdUpTo8(1.2) => "$1.2"
 *  - formatUsdUpTo8(1) => "$1"
 *
 * @param {number|string} value - The numeric value to format.
 * @param {{symbol?: string}} [options] - Optional formatting options; symbol defaults to "$".
 * @returns {string} The formatted currency string or "—" when value is invalid.
 */
export function formatUsdUpTo8(value, options = {}) {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  const nf = new Intl.NumberFormat(undefined, {
    useGrouping: true,
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  });
  const absStr = nf.format(Math.abs(n));
  const prefix = n < 0 ? "-" : "";
  const symbol = options.symbol ?? "$";
  return `${prefix}${symbol}${absStr}`;
}
