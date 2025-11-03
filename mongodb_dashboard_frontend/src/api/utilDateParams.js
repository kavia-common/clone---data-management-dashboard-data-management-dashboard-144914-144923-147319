export function toDateParamStrings({ startDate, endDate } = {}) {
  // Normalize to ISO strings without milliseconds to avoid backend parsing issues
  const fmt = (d) => {
    try {
      if (!d) return undefined;
      const date = typeof d === 'string' ? new Date(d) : d;
      if (Number.isNaN(date?.getTime())) return undefined;
      return date.toISOString();
    } catch {
      return undefined;
    }
  };
  const start = fmt(startDate);
  const end = fmt(endDate);
  if (!start && !end) return {};
  // Only include when set, both or individually
  const params = {};
  if (start) params.startDate = start;
  if (end) params.endDate = end;
  return params;
}

/**
 * PUBLIC_INTERFACE
 * Merges provided params with normalized date params.
 * Accepts legacy { from, to } and prefers explicit startDate/endDate if provided.
 */
export function withDateParams(params = {}, dateRange = {}) {
  /** This function merges existing query params and a dateRange into a single query params object
   *  - prefers startDate/endDate in dateRange
   *  - if missing, maps legacy from/to into startDate/endDate
   *  - if dates are not provided, omits both so backend returns unfiltered results
   */
  const normalized = {};
  const startDate = dateRange.startDate ?? dateRange.start ?? dateRange.from;
  const endDate = dateRange.endDate ?? dateRange.end ?? dateRange.to;

  const dateParams = toDateParamStrings({ startDate, endDate });

  // Remove any legacy keys from params to avoid duplication
  const { from, to, start, end, ...rest } = params || {};
  return { ...rest, ...dateParams };
}
