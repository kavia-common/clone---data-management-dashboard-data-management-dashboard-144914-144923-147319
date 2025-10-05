export const formatCurrency = (val, currency = 'USD') => {
  if (val == null || Number.isNaN(Number(val))) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(val));
  } catch {
    return `$${Number(val).toFixed(2)}`;
  }
};

// PUBLIC_INTERFACE
export const formatUsdUpTo8 = (val) => {
  /** Formats a number as USD with up to 8 decimal places, trimming trailing zeros. */
  if (val == null || Number.isNaN(Number(val))) return '—';
  try {
    const n = Number(val);
    // Use maximum 8 fraction digits but not always fixed to 8
    const str = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 8,
    }).format(n);
    return str;
  } catch {
    const n = Number(val);
    return `$${n.toFixed(2)}`;
  }
};
