'use strict';

/**
 * creditsConfig.js
 * ----------------
 * Shared configuration constants for the credits system.
 *
 * *** TO EDIT THE CREDITS MULTIPLIER ***
 * Change the CREDIT_MULTIPLIER value below.
 * The multiplier defines how many credits equal 1 USD of cost.
 * Default: 20000 credits per 1 USD.
 *
 * This constant is intentionally kept here as the single source of truth.
 * Any backend service or controller that computes credits should import from this file.
 *
 * Note: The multiplier can also be overridden at runtime via the CREDITS_PER_USD
 * environment variable (parsed in src/utils/credits.js). The env var takes precedence
 * when set; otherwise this constant is used as the fallback default.
 */

// PUBLIC_INTERFACE
/**
 * CREDIT_MULTIPLIER
 * Number of credits awarded per 1 USD of session cost.
 *
 * *** EDIT HERE to change the credits conversion rate ***
 */
const CREDIT_MULTIPLIER = 20000;

module.exports = {
  CREDIT_MULTIPLIER,
};
