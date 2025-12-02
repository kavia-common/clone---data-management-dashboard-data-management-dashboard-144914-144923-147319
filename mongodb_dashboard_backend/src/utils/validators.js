'use strict';

/**
// PUBLIC_INTERFACE
 * isValidUrl
 * Validates that a string is an http(s) URL using the URL constructor.
 */
function isValidUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
// PUBLIC_INTERFACE
 * isValidEmail
 * Lightweight email validation regex for backend gating.
 */
function isValidEmail(value) {
  // Simplified email check; avoids unnecessary escapes in character classes
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * PUBLIC_INTERFACE
 * Exports validator helpers used across middleware and controllers.
 */
module.exports = { isValidUrl, isValidEmail };
