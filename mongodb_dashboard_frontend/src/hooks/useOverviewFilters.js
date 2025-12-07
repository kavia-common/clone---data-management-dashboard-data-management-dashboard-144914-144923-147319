import { useContext } from 'react';
import { DataContext } from '../context/DataContext';

/**
 * PUBLIC_INTERFACE
 * useOverviewFilters
 * Returns shared Overview filter state from DataContext.
 * Expected structure:
 *   {
 *     tenantId?: string,
 *     timeRange?: { mode?: 'day'|'week'|'month'|'custom', start?: Date|ISO, end?: Date|ISO },
 *     granularity?: 'day'|'week'|'month',
 *     lastEventId?: number
 *   }
 */
export default function useOverviewFilters() {
  try {
    const ctx = useContext(DataContext) || {};
    // common shapes used in repo: ctx.overviewFilters or ctx.filters
    return ctx.overviewFilters || ctx.filters || {};
  } catch {
    return {};
  }
}

// Re-export as named for convenience without re-declaring identifier
export { default as useOverviewFilters } from './useOverviewFilters';
