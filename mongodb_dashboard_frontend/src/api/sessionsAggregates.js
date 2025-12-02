import { getApiClient } from "./baseClient";

const memoryCache = new Map();
const DEFAULT_TTL = 45 * 1000;

function keyOf(path, params) {
  return `${path}:${JSON.stringify(params || {})}`;
}

function getCached(k) {
  const ent = memoryCache.get(k);
  if (!ent) return null;
  if (Date.now() > ent.expiresAt) {
    memoryCache.delete(k);
    return null;
  }
  return ent.value;
}

function setCached(k, value, ttl = DEFAULT_TTL) {
  memoryCache.set(k, { value, expiresAt: Date.now() + ttl });
}

/**
 * PUBLIC_INTERFACE
 * getSessionsByType
 * Debounced/cancellable request for sessions by type.
 */
export function getSessionsByType(params = {}, { signal } = {}) {
  const client = getApiClient();
  const path = "/api/sessions/by-type";
  const k = keyOf(path, params);
  const cached = getCached(k);
  if (cached) {
    return Promise.resolve(cached);
  }
  return client
    .get(path, { params, signal })
    .then((res) => {
      const data = res?.data?.items ?? res?.data ?? [];
      setCached(k, data);
      return data;
    });
}

/**
 * PUBLIC_INTERFACE
 * getSessionsByOrganization
 * Debounced/cancellable request for sessions by organization.
 */
export function getSessionsByOrganization(params = {}, { signal } = {}) {
  const client = getApiClient();
  const path = "/api/sessions/by-organization";
  const k = keyOf(path, params);
  const cached = getCached(k);
  if (cached) {
    return Promise.resolve(cached);
  }
  return client
    .get(path, { params, signal })
    .then((res) => {
      const data = res?.data?.items ?? res?.data ?? [];
      setCached(k, data);
      return data;
    });
}

/**
 * PUBLIC_INTERFACE
 * buildChartParams
 * Consolidate filters into minimal params object: { start, end, limit }
 */
export function buildChartParams({ startDate, endDate, limit = 10 } = {}) {
  const toIso = (d) => {
    if (!d) return undefined;
    try {
      if (typeof d === "string") {
        // if date-only string, set end-of-day for end, 00:00 for start
        const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(d);
        if (isDateOnly) return new Date(d).toISOString();
        return new Date(d).toISOString();
      }
      if (d instanceof Date) return d.toISOString();
    } catch {}
    return undefined;
  };

  const start = toIso(startDate);
  let end = toIso(endDate);

  // For date-only inputs (YYYY-MM-DD without time), expand end to end-of-day
  if (typeof endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    try {
      const e = new Date(endDate);
      e.setHours(23, 59, 59, 999);
      end = e.toISOString();
    } catch {}
  }

  return { ...(start ? { start } : {}), ...(end ? { end } : {}), limit };
}
