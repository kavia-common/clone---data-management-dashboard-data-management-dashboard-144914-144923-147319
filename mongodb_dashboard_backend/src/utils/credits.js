'use strict';

/**
 * PUBLIC_INTERFACE
 * Credits utilities:
 * - Allow configuration of CREDITS_PER_USD via env (CREDITS_PER_USD), defaulting to 20000.
 * - Provide helpers for converting USD to credits and formatting values.
 *
 * Business rule:
 *  - credits = Math.round(total_cost_usd * CREDITS_PER_USD)
 *
 * Env:
 *  - CREDITS_PER_USD: number of credits per 1 USD (default 20000)
 *
 * Note:
 *  - Reasonable default avoids dependency on .env for local/CI. To customize, set CREDITS_PER_USD in environment.
 */

// PUBLIC_INTERFACE
function getCreditsPerUsd() {
  /** Returns numeric conversion factor from env or default 20000. */
  const raw = process.env.CREDITS_PER_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 20000;
}

// PUBLIC_INTERFACE
function usdToCredits(usd) {
  /** Converts USD amount to integer credits (rounded). */
  const n = Number(usd);
  if (!Number.isFinite(n)) {return 0;}
  const factor = getCreditsPerUsd();
  return Math.round(n * factor);
}

// PUBLIC_INTERFACE
function formatCredits(credits) {
  /** Formats credits with thousands separators and "credits" suffix. */
  const n = Number(credits);
  const v = Number.isFinite(n) ? n : 0;
  try {
    return `${v.toLocaleString()} credits`;
  } catch {
    return `${v} credits`;
  }
}

module.exports = {
  getCreditsPerUsd,
  usdToCredits,
  formatCredits,
};
