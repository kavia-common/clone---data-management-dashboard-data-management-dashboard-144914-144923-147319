//
// PUBLIC_INTERFACE
// formatLabel - Utility to display JSON keys in a human-friendly way.
// Replaces underscores with spaces and capitalizes each word without mutating data.
/**
 * Converts a snake_case or underscored label into Title Case with spaces.
 * Examples:
 *  - "user_id" -> "User ID"
 *  - "tenant_name" -> "Tenant Name"
 *  - "_id" -> "Id"
 *
 * Notes:
 * - Does not alter the original key/data; purely for display.
 * - Performs basic acronym handling by uppercasing segments that look like common short codes.
 *
 * @param {string} key Original object key
 * @returns {string} Formatted display label
 */
// PUBLIC_INTERFACE
export function formatLabel(key) {
  if (key == null) return '';
  const raw = String(key)
    .replace(/[_\s]+/g, ' ')          // underscores/spaces -> single space
    .trim();

  if (!raw) return '';

  // Split into words and capitalize
  const words = raw.split(' ').filter(Boolean);

  const commonAcronyms = new Set([
    'id', 'url', 'api', 'ip', 'ui', 'uid', 'cpu', 'gpu', 'ram', 'db'
  ]);

  const formatted = words
    .map((w) => {
      const lower = w.toLowerCase();
      if (commonAcronyms.has(lower)) {
        return lower.toUpperCase();
      }
      // Capitalize first letter, lower-case the rest
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');

  return formatted;
}

export default formatLabel;
