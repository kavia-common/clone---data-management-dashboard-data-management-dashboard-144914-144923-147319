/**
 * Utility string helpers with safe, minimal transforms used by backend only.
 * Avoids unnecessary escape characters; focuses on trimming and normalizing whitespace.
 */

// PUBLIC_INTERFACE
function normalizeWhitespace(str) {
  /** Normalize whitespace to single spaces and trim ends. */
  if (typeof str !== 'string') {
    return str;
  }
  return str.replace(/\s+/g, ' ').trim();
}

// PUBLIC_INTERFACE
function toTitleCase(str) {
  /** Convert a string to Title Case in a locale-agnostic manner. */
  if (typeof str !== 'string') {
    return str;
  }
  return str
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * PUBLIC_INTERFACE
 * Parses a mongoose sort string like "-created_at" or "name"
 * Returns an object { field: direction }
 */
function parseSort(sortStr) {
  if (!sortStr || typeof sortStr !== 'string') return null;
  const isDesc = sortStr.startsWith('-'); // '-' does not need escaping
  const field = sortStr.replace(/^-/, '');
  if (!field) return null;
  const direction = isDesc ? -1 : 1;
  return { [field]: direction };
}

module.exports = {
  normalizeWhitespace,
  toTitleCase,
  parseSort,
};
