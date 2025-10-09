//
// Utility helpers for reading and formatting Credits values from API responses.
//

/**
 * Safely extract credits used from a details response, preferring camelCase and
 * falling back to snake_case. Returns null if neither exists or not a finite number.
 */
export function getCreditsUsed(details) {
  if (!details || typeof details !== 'object') return null;
  const raw =
    details.creditsUsed ??
    details.credits_used ??
    // Some APIs may nest under data; try shallow nested fallback
    (details.data && (details.data.creditsUsed ?? details.data.credits_used));

  const num = typeof raw === 'string' ? Number(raw) : raw;
  return Number.isFinite(num) ? num : null;
}

/**
 * Format number with locale-aware formatting and fixed precision rules
 * to avoid scientific notation and keep UI consistent.
 */
export function formatCredits(value, locale = undefined) {
  if (value === null || value === undefined) return '—';
  try {
    // Use compact but precise formatting: up to 4 decimals if fractional exists
    const hasFraction = Math.abs(value % 1) > 0;
    const minimumFractionDigits = hasFraction ? 2 : 0;
    const maximumFractionDigits = hasFraction ? 4 : 0;
    return Number(value).toLocaleString(locale, {
      minimumFractionDigits,
      maximumFractionDigits,
    });
  } catch {
    return '—';
  }
}
