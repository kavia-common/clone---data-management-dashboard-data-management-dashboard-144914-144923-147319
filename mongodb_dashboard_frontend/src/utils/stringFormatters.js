//
// Utilities for formatting strings across the application.
//

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
    .replace(/[_\-]+/g, ' ')  // underscores/hyphens -> space
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
