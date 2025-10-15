import { formatCurrencyAmount } from "../../utils/formatCurrency";

// PUBLIC_INTERFACE
export const formatCurrency = (val, currency = 'USD') => {
  /** Backward-compatible wrapper around formatCurrencyAmount for generic currency formatting. */
  return formatCurrencyAmount(val, { currency });
};

// PUBLIC_INTERFACE
export const formatUsdUpTo8 = (val) => {
  /** Formats a number as USD with up to 8 decimal places, trimming trailing zeros. */
  return formatCurrencyAmount(val, { currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 8 });
};
