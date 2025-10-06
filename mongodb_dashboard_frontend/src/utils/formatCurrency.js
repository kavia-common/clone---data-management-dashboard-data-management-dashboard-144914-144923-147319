//
// Currency formatting utility for consistent display across the app.
// Ensures leading $ for USD and dynamic fractional digits without unnecessary trailing zeros.
//

// PUBLIC_INTERFACE
export function formatCurrencyAmount(value, options = {}) {
  /** Format a numeric value as currency text.
   * - Always shows a leading $ for USD.
   * - Preserves up to 6–8 decimals for small values (e.g., $0.043674), with dynamic precision based on magnitude.
   * - Avoids unnecessary trailing zeros by using Intl.NumberFormat with min/max fraction digits.
   *
   * Usage:
   *   formatCurrencyAmount(0.043674) => "$0.043674"
   *   formatCurrencyAmount(12) => "$12.00"
   *   formatCurrencyAmount(0.00001234) => "$0.00001234"
   *   formatCurrencyAmount(1234.5678, { currency: 'USD' }) => "$1,234.568"
   *
   * @param {number|string} value - Numeric value to format (number or numeric string)
   * @param {object} options
   * @param {string} [options.currency='USD'] - ISO currency code
   * @param {number} [options.minimumFractionDigits] - Optional override for min fraction digits
   * @param {number} [options.maximumFractionDigits] - Optional override for max fraction digits
   * @returns {string} The formatted currency string, or '—' for null/invalid.
   */
  const { currency = 'USD', minimumFractionDigits, maximumFractionDigits } = options;

  if (value == null) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';

  // Determine dynamic fraction digits if not overridden via options.
  const abs = Math.abs(n);
  let minFrac = typeof minimumFractionDigits === 'number' ? minimumFractionDigits : 2;
  let maxFrac = typeof maximumFractionDigits === 'number' ? maximumFractionDigits : undefined;

  if (maxFrac == null) {
    // Dynamic rules to balance readability and precision.
    if (abs === 0) {
      // Keep it compact for zero
      minFrac = 2;
      maxFrac = 6;
    } else if (abs < 0.0001) {
      // Extremely small numbers: allow up to 8 decimals
      minFrac = Math.min(minFrac, 4);
      maxFrac = 8;
    } else if (abs < 0.01) {
      // Very small numbers
      minFrac = Math.min(minFrac, 4);
      maxFrac = 8;
    } else if (abs < 1) {
      // Small decimals
      minFrac = Math.min(minFrac, 4);
      maxFrac = 6;
    } else if (abs < 1000) {
      // Typical values
      minFrac = Math.max(minFrac, 2);
      maxFrac = 4;
    } else {
      // Large values: fixed 2 decimals
      minFrac = 2;
      maxFrac = 2;
    }
  }

  try {
    // Intl handles both $ prefix and grouping.
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: minFrac,
      maximumFractionDigits: maxFrac,
    }).format(n);
  } catch {
    // Fallback: basic USD-like formatting. Thousands separator omitted in fallback to avoid locale issues.
    const sym = (currency || 'USD').toUpperCase() === 'USD' ? '$' : '';
    const digits = typeof maxFrac === 'number' ? maxFrac : 2;
    const basic = n.toFixed(Math.max(minFrac, digits));
    return sym ? `${sym}${basic}` : `${basic} ${currency || ''}`.trim();
  }
}
