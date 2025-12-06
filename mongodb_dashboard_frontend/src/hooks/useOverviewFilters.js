import { useContext } from 'react';
import { DataContext } from '../context/DataContext';

/**
 * PUBLIC_INTERFACE
 * useOverviewFilters
 * Returns global overview filters from DataContext if provided. Otherwise returns an empty object to avoid crashes.
 */
export function useOverviewFilters() {
  try {
    const ctx = useContext(DataContext);
    // Many pages store filters on ctx.filters or ctx.overviewFilters; use either and fallback.
    return (ctx && (ctx.overviewFilters || ctx.filters)) || {};
  } catch {
    return {};
  }
}

export default useOverviewFilters;
