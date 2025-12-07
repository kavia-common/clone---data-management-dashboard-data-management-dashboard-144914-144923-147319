import { getApiBaseUrl } from './config';
import { buildOverviewFilterParams } from './buildOverviewFilterParams';
import { sanitizeRequestParams } from './requestSanitizer';

/**
 * Base JSON fetch helper for GET requests with query params.
 * Mirrors existing API clients in this codebase.
 */
async function getJson(path, params = {}, options = {}) {
  const base = getApiBaseUrl?.() || '';
  const url = new URL(path, base);
  const sanitized = sanitizeRequestParams ? sanitizeRequestParams(params) : params;
  Object.entries(sanitized || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  });

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    credentials: 'include',
    signal: options.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const error = new Error(`Request failed (${res.status}): ${text || res.statusText}`);
    error.status = res.status;
    error.body = text;
    throw error;
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    // Fallback: try parse to JSON, else return raw text
    try {
      return await res.json();
    } catch {
      return await res.text();
    }
  }
  return res.json();
}

/**
 * PUBLIC_INTERFACE
 * Fetch session tracking list with shared overview filters.
 * Accepts tenantId, rangeType, dateStart, dateEnd and optional page/limit.
 * Builds query params to align with how UsersByTenantOverviewChart sends filters.
 */
export async function fetchSessionTracking({
  tenantId,
  rangeType,
  dateStart,
  dateEnd,
  page,
  limit,
  q,
  sort,
} = {}) {
  /** This function constructs query parameters for the /api/session-tracking listing endpoint.
   * It uses the same filter building logic used across Overview (buildOverviewFilterParams),
   * mapping rangeType+dateStart/dateEnd into from/to where relevant, and attaches tenant_id.
   */
  const timeParams = buildOverviewFilterParams
    ? buildOverviewFilterParams({ rangeType, dateStart, dateEnd })
    : {};

  const params = {
    ...(tenantId ? { tenant_id: tenantId, organization_id: tenantId } : {}),
    ...(timeParams || {}),
    ...(page ? { page } : {}),
    ...(limit ? { limit } : {}),
    ...(q ? { q } : {}),
    ...(sort ? { sort } : {}),
    // NOTE: The /api/session-tracking endpoint supports an optional "filter" param (JSON string),
    // but for consistency we pass tenant_id directly and time as from/to via buildOverviewFilterParams.
  };

  return getJson('/api/session-tracking', params);
}

export default {
  fetchSessionTracking,
}
