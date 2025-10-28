//
// PUBLIC_INTERFACE
// formatStatusLabel - Utility to display deployment statuses in a human-friendly way.
// Replaces underscores/hyphens with spaces and converts to Title Case without mutating data.
/**
 * PUBLIC_INTERFACE
 * formatStatusLabel
 * Convert a raw status code (e.g., "in_progress", "FAILED") into a human-readable label
 * (e.g., "In Progress", "Failed") for display purposes only.
 *
 * Behavior:
 * - Treats null/undefined/empty as "Unknown"
 * - Replaces underscores/hyphens with spaces
 * - Collapses multiple spaces
 * - Lowercases then Title-Cases words (preserves apostrophes)
 *
 * Examples:
 *  - "in_progress"     -> "In Progress"
 *  - "FAILED"          -> "Failed"
 *  - "QUEUED-JOB"      -> "Queued Job"
 *  - "" or null        -> "Unknown"
 *
 * @param {string} value Raw status code
 * @returns {string} Human-readable status label
 */
export function formatStatusLabel(value) {
  const fallback = "Unknown";
  if (value == null) return fallback;

  const normalized = String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return fallback;

  // Title Case: lowercase everything then capitalize first letter of each word
  const lower = normalized.toLowerCase();

  // Capitalize word starts and letters following an apostrophe (straight or curly)
  const latinLetter = "A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff";
  const title = lower
    .replace(new RegExp(`\\b([${latinLetter}])`, "g"), (_, ch) => ch.toUpperCase())
    .replace(new RegExp(`([\u2019'])(\\s*)([${latinLetter}])`, "g"), (_, quote, spaces, ch) => quote + spaces + ch.toUpperCase());

  return title;
}

export default formatStatusLabel;
