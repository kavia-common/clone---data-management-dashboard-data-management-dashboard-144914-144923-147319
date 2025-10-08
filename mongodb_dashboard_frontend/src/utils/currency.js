//
// Currency-to-credits conversion utility.
// Centralizes the conversion rate so the entire app stays consistent.
//

// PUBLIC_INTERFACE
export const CREDITS_PER_USD = 20000;

/**
 * PUBLIC_INTERFACE
 * Convert a USD amount to credits based on the shared rate.
 * @param {number} usd - The USD amount
 * @returns {number} Integer credits, rounded to nearest whole credit
 */
export function usdToCredits(usd) {
  const n = Number(usd);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * CREDITS_PER_USD);
}

// PUBLIC_INTERFACE
export function formatCredits(n) {
  /** Formats numeric credits with thousands separators and a "credits" suffix.
   *  Examples:
   *   formatCredits(100000) => "100,000 credits"
   *   formatCredits(0) => "0 credits"
   */
  const num = Number(n);
  const v = Number.isFinite(num) ? num : 0;
  try {
    return `${v.toLocaleString()} credits`;
  } catch {
    return `${v} credits`;
  }
}
