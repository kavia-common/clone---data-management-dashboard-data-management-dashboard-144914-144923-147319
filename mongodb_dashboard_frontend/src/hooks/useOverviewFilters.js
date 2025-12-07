import { useContext, useMemo } from 'react';
import { DataContext } from '../context/DataContext';

/**
 * PUBLIC_INTERFACE
 * useOverviewFilters
 * Returns global overview filters from DataContext when available, with a normalized shape:
 * { granularity?: 'day'|'week'|'month'|'custom', from?: ISO, to?: ISO, tenant_id?, organization_id? }
 */
export default function useOverviewFilters() {
  let raw = {};
  try {
    const ctx = useContext(DataContext);
    raw = (ctx && (ctx.overviewFilters || ctx.filters)) || {};
  } catch {
    raw = {};
  }

  // Normalize various shapes into a consistent contract
  return useMemo(() => {
    const granularity =
      raw.granularity ||
      raw.rangeType ||
      (raw.range && raw.range.granularity) ||
      undefined;

    const from =
      raw.from ||
      raw.dateStart ||
      (raw.range && raw.range.from) ||
      undefined;

    const to =
      raw.to ||
      raw.dateEnd ||
      (raw.range && raw.range.to) ||
      undefined;

    const tenant_id = raw.tenant_id || raw.tenantId || raw.organization_id || raw.organizationId;

    return {
      ...raw,
      granularity,
      from,
      to,
      tenant_id,
      organization_id: tenant_id,
    };
  }, [raw]);
}
