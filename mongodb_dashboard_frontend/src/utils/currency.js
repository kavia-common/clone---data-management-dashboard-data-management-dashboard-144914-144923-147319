//
// Currency-to-credits conversion utility.
// Centralizes the conversion rate so the entire app stays consistent.
//

import React from "react";
import { formatCurrencyAmount } from "./formatCurrency";

// PUBLIC_INTERFACE
export const CREDITS_PER_USD =
  Number(process.env.REACT_APP_CREDITS_PER_USD) > 0
    ? Number(process.env.REACT_APP_CREDITS_PER_USD)
    : 20000;

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

// PUBLIC_INTERFACE
export function formatUSD(usd, options = {}) {
  /**
   * Format a value as USD using the shared currency formatter.
   * Falls back to an em dash on invalid input.
   * @param {number|string} usd
   * @param {object} options - forwarded to formatCurrencyAmount (e.g., { maximumFractionDigits: 6 })
   * @returns {string}
   */
  const n = Number(usd);
  if (!Number.isFinite(n)) return "—";
  return formatCurrencyAmount(n, { currency: "USD", ...options });
}

/**
 * PUBLIC_INTERFACE
 * Render credits first with USD secondary: "N credits ($X)".
 * Accepts numeric or numeric string; preserves non-numeric strings as-is.
 */
// PUBLIC_INTERFACE
export function renderCreditsWithUsd(usd, options = {}) {
  if (usd == null || usd === "") return "—";
  const n = typeof usd === "number" ? usd : Number(usd);
  if (!Number.isFinite(n)) {
    return typeof usd === "string" ? usd : "—";
  }
  const creditsTxt = formatCredits(usdToCredits(n));
  const usdTxt = formatCurrencyAmount(n, { currency: "USD", ...options });
  const title = `${creditsTxt} (${usdTxt})`;
  return (
    <span title={title} style={{ whiteSpace: "nowrap" }}>
      {creditsTxt}
      <span className="credits-inline muted">({usdTxt})</span>
    </span>
  );
}

// Keep the original export for compatibility where needed
export function renderUsdWithCredits(usd, options = {}) {
  return renderCreditsWithUsd(usd, options);
}
