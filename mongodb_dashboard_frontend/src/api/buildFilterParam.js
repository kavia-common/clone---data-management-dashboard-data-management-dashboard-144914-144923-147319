//
// PUBLIC_INTERFACE
// buildFilterParam
/** Serialize an object filter into a URL-safe string using encodeURIComponent(JSON.stringify()).
 * Safely handles null/undefined by returning undefined so callers can omit the parameter.
 * Numeric, boolean, and string values are allowed; Dates are auto-converted to ISO strings.
 */
export function buildFilterParam(filter) {
  if (!filter || typeof filter !== 'object') return undefined;
  // Convert Date instances to ISO recursively
  const normalize = (v) => {
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(v)) out[k] = normalize(val);
      return out;
    }
    return v;
  };
  try {
    const normalized = normalize(filter);
    return encodeURIComponent(JSON.stringify(normalized));
  } catch {
    return undefined;
  }
}
