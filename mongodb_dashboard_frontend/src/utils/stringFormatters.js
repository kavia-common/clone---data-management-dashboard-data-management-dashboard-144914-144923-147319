//
//
// Utilities for formatting strings across the application.
//
// This module centralizes string normalization routines used by the UI to ensure
// consistent rendering across components.

// PUBLIC_INTERFACE
export function toCamelCaseName(value) {
  /** Convert a typical name/string to camelCase.
   * - Handles spaces, underscores, hyphens as delimiters
   * - Collapses multiple whitespace
   * - Trims leading/trailing whitespace
   * - Returns the original value if not a string
   *
   * Examples:
   *  "John Doe"           -> "johnDoe"
   *  "  john   doe  "     -> "johnDoe"
   *  "john_doe"           -> "johnDoe"
   *  "john-doe"           -> "johnDoe"
   *  "JOHN_DOE-SMITH"     -> "johnDoeSmith"
   */
  if (typeof value !== 'string') return value;

  const normalized = value
    .trim()
    .replace(/[-_]+/g, ' ')  // underscores/hyphens -> space
    .replace(/\s+/g, ' ');    // collapse multiple spaces

  if (!normalized) return '';

  const parts = normalized.split(' ');
  const first = parts[0].toLowerCase();
  const rest =
    parts
      .slice(1)
      .map((p) => (p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : ''))
      .join('');

  return first + rest;
}

// PUBLIC_INTERFACE
export function toTitleCaseName(value) {
  /** Convert a typical user name/string to Title Case for display.
   * - Returns the original value unchanged if not a string
   * - Trims leading/trailing whitespace
   * - Replaces underscores and hyphens with spaces
   * - Collapses multiple spaces
   * - Lowercases entire string, then capitalizes:
   *     - first letter of each word
   *     - and the letter after an apostrophe (e.g., D'Angelo)
   * - Preserves apostrophes and accented characters
   *
   * Examples:
   *  "prasanth"              -> "Prasanth"
   *  "john_doe-smith"        -> "John Doe Smith"
   *  "  maría   d’angelo  "  -> "María D’Angelo"
   *  "o'connor"              -> "O'Connor"
   */
  if (typeof value !== 'string') return value;

  // Normalize delimiters and spacing
  const normalized = value
    .trim()
    .replace(/[_\-]+/g, ' ')  // underscores/hyphens -> space
    .replace(/\s+/g, ' ');    // collapse multiple spaces

  if (!normalized) return '';

  // Lowercase first to standardize, then Title Case
  const lower = normalized.toLowerCase();

  // Capitalize first letter of each word and letter after an apostrophe.
  // Use a Latin letter class that includes common accents.
  const latinLetter = "A-Za-zÀ-ÖØ-öø-ÿ";
  const titleCased = lower
    // Start-of-word capitalization
    .replace(new RegExp(`\\b([${latinLetter}])`, 'g'), (_, ch) => ch.toUpperCase())
    // After apostrophe (straight or curly)
    .replace(new RegExp(`([’'])(\\s*)([${latinLetter}])`, 'g'), (_, quote, spaces, ch) => quote + spaces + ch.toUpperCase());

  return titleCased;
}
