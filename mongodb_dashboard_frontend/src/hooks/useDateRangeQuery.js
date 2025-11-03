import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * PUBLIC_INTERFACE
 * useDateRangeQuery
 * Hook to manage startDate/endDate in component state, synced with URL query params.
 * - Formats: YYYY-MM-DD in URL and component state
 * - Provides: startDate, endDate, setDates({startDate, endDate}), clearDates(),
 *             withDateParams(baseParams) to extend API params with ISO datetimes.
 *
 * Backend expectations (per OpenAPI):
 *  - Some endpoints expect "start" & "end" (ISO datetime)
 *  - Others expect "from" & "to" (ISO datetime)
 * We add both when present for broader compatibility. If page needs specificity,
 * it can override.
 */
export default function useDateRangeQuery() {
  const location = useLocation();
  const navigate = useNavigate();

  // Parse existing query
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const initialStart = params.get('startDate');
  const initialEnd = params.get('endDate');

  const [startDate, setStartDate] = useState(initialStart);
  const [endDate, setEndDate] = useState(initialEnd);

  // Keep URL in sync when state changes
  useEffect(() => {
    const next = new URLSearchParams(location.search);
    if (startDate) next.set('startDate', startDate);
    else next.delete('startDate');

    if (endDate) next.set('endDate', endDate);
    else next.delete('endDate');

    const nextSearch = next.toString();
    const currentSearch = location.search.replace(/^\?/, '');
    if (nextSearch !== currentSearch) {
      // Use replace to avoid adding history entries and prevent any default navigation reloads
      navigate({ pathname: location.pathname, search: `?${nextSearch}` }, { replace: true });
    }
  }, [startDate, endDate, location.pathname, location.search, navigate]);

  const setDates = useCallback(({ startDate: s, endDate: e }) => {
    setStartDate(s || null);
    setEndDate(e || null);
  }, []);

  const clearDates = useCallback(() => {
    setStartDate(null);
    setEndDate(null);
  }, []);

  // Utilities for API query params. Convert YYYY-MM-DD to full-day ISO intervals.
  const buildIsoRange = useCallback(() => {
    const res = {};
    if (startDate) res.fromISO = new Date(`${startDate}T00:00:00.000Z`).toISOString();
    if (endDate) res.toISO = new Date(`${endDate}T23:59:59.999Z`).toISOString();
    return res;
  }, [startDate, endDate]);

  const withDateParams = useCallback(
    (baseParams = {}) => {
      const { fromISO, toISO } = buildIsoRange();
      const p = { ...baseParams };
      // Apply both naming schemes if defined
      if (fromISO) {
        p.from = fromISO;
        p.start = fromISO;
      }
      if (toISO) {
        p.to = toISO;
        p.end = toISO;
      }
      return p;
    },
    [buildIsoRange]
  );

  return {
    startDate,
    endDate,
    setDates,
    clearDates,
    withDateParams,
  };
}
