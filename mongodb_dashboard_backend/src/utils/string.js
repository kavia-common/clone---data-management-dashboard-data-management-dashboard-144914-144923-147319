'use strict';

/**
 * Utility string helpers with safe, minimal transforms used by backend only.
 */

// PUBLIC_INTERFACE
function escapeRegex(str) {
  /** Escape regex special characters for safe construction in new RegExp */
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// PUBLIC_INTERFACE
function isBlank(s) {
  /** Returns true if string is null/undefined/empty or whitespace only */
  return !s || /^\s+$/.test(s);
}

// PUBLIC_INTERFACE
function normalizeWhitespace(str) {
  /** Normalize whitespace to single spaces and trim ends. */
  if (typeof str !== "string") {
    return str;
  }
  return str.replace(/\s+/g, " ").trim();
}

// PUBLIC_INTERFACE
function toTitleCase(str) {
  /** Convert a string to Title Case in a locale-agnostic manner. */
  if (typeof str !== "string") {
    return str;
  }
  return str
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

module.exports = {
  escapeRegex,
  isBlank,
  normalizeWhitespace,
  toTitleCase,
};
