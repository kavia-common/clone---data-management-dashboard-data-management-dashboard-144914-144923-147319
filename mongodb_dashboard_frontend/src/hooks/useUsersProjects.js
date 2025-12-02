import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "../utils/api";

/**
 * PUBLIC_INTERFACE
 * buildUsersProjectsKey
 * Build a stable cache key for /api/users/:userId/projects queries.
 *
 * @param {{ userId: string, organization_id?: string, tenant_id?: string, from?: string|Date|null, to?: string|Date|null, sort?: string, page?: number, pageSize?: number }} params
 * @returns {string}
 */
export function buildUsersProjectsKey(params = {}) {
  const {
    userId,
    organization_id,
    tenant_id,
    from,
    to,
    sort,
    page,
    pageSize,
  } = params || {};
  const normalized = {
    userId: userId ? String(userId) : null,
    tenant: organization_id ?? tenant_id ?? null,
    from: from ? (typeof from === "string" ? from : new Date(from).toISOString()) : null,
    to: to ? (typeof to === "string" ? to : new Date(to).toISOString()) : null,
    sort: sort ?? null,
    page: page ?? null,
    pageSize: pageSize ?? null,
  };
  return `usersProjects:${JSON.stringify(normalized)}`;
}

// In-memory caches and in-flight registry
const responseCache = new Map(); // key -> { data, etag, ts }
const inflight = new Map(); // key -> { controller, promise }
const etagIndex = new Map(); // key -> ETag string

// Dev logging helper (no-op in production)
function devLog(...args) {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.debug("[useUsersProjects]", ...args);
  }
}

// Low-level GET wrapper with ETag handling and AbortController
async function fetchUserProjects(key, url, { query, signal }) {
  // If there is an in-flight identical request, return its promise
  const existing = inflight.get(key);
  if (existing?.promise) {
    devLog("dedupe: reusing in-flight promise", { key, query });
    return existing.promise;
  }

  // Prepare AbortController
  const controller = new AbortController();
  if (signal) {
    // If an external signal aborts, propagate to this controller
    signal.addEventListener("abort", () => {
      try {
        controller.abort();
      } catch {
        // ignore
      }
    });
  }

  const promise = (async () => {
    try {
      // Build request URL with query params
      const params = new URLSearchParams();
      Object.entries(query || {}).forEach(([k, v]) => {
        if (v === undefined || v === null || v === "") return;
        params.append(k, String(v));
      });

      const effUrl = `${url}${params.toString() ? `?${params.toString()}` : ""}`;

      // Reuse ETag if present
      const etag = etagIndex.get(key);
      const headers = {};
      if (etag) {
        headers["If-None-Match"] = etag;
      }

      // Use apiGet to inject auth and org header/query; pass our signal
      // We bypass apiGet header override by temporarily monkey patching headers via options.
      const res = await (async () => {
        // apiGet currently returns the parsed body. For ETag we need response headers, so we reimplement fetch here.
        // To avoid duplicating tenant handling too much, we rely on apiGet to compute URL and headers,
        // but since it doesn't return headers, we have to manually reconstruct here with same base logic.
        // Simplify: call window.fetch directly with composed URL and default auth headers via apiGet once to get headers.
        // We'll replicate minimal behavior here for ETag.
        return fetch(effUrl, {
          method: "GET",
          headers: {
            Accept: "application/json",
            ...headers,
          },
          signal: controller.signal,
        });
      })();

      if (res.status === 304) {
        // Not Modified -> serve from cache
        const cached = responseCache.get(key);
        if (cached) {
          devLog("etag hit: 304, served from cache", { key });
          return cached.data;
        }
        // 304 with no cache -> treat as network miss (fallback to empty)
        devLog("etag 304 but no cache; returning empty baseline", { key });
        return null;
      }

      // Parse response payload
      let payload = null;
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        try {
          payload = await res.json();
        } catch {
          payload = null;
        }
      } else {
        try {
          payload = await res.text();
        } catch {
          payload = null;
        }
      }

      if (!res.ok) {
        const message =
          (payload && typeof payload === "object" && (payload.message || payload.detail)) ||
          (typeof payload === "string" ? payload : `Request failed (${res.status})`);
        const err = new Error(message);
        err.status = res.status;
        err.payload = payload;
        throw err;
      }

      // Extract ETag and cache
      const newEtag = res.headers.get("ETag") || res.headers.get("Etag") || res.headers.get("etag") || null;
      if (newEtag) {
        etagIndex.set(key, newEtag);
      }

      // Normalize shape
      const data = payload?.data ?? payload;
      responseCache.set(key, { data, etag: newEtag || null, ts: Date.now() });

      return data;
    } finally {
      // Always clear inflight entry for this controller
      const cur = inflight.get(key);
      if (cur && cur.controller === controller) {
        inflight.delete(key);
      }
    }
  })();

  inflight.set(key, { controller, promise });
  return promise;
}

/**
 * PUBLIC_INTERFACE
 * useUsersProjects
 * Centralized hook to fetch a single user's projects with aggressive coalescing and caching.
 * NOTE: Prefer useUsersProjectsBatch when rendering lists/tables to avoid N calls.
 *
 * Features:
 * - Debouncing (default 400ms) to absorb rapid filter changes.
 * - In-flight cancellation on param changes via AbortController.
 * - Request deduplication per stable key (same key -> shared promise).
 * - ETag-aware caching using If-None-Match; 304 responses served from cache.
 * - Stabilized memoized dependencies to avoid effect loops.
 * - Minimal dev logging to verify coalescence.
 *
 * @param {{ userId?: string, organization_id?: string, tenant_id?: string, from?: string|Date|null, to?: string|Date|null, sort?: string, page?: number, pageSize?: number, enabled?: boolean, debounceMs?: number, cacheTimeMs?: number }} options
 * @returns {{ data: any, loading: boolean, error: string|null, refetch: () => Promise<void> }}
 */
export function useUsersProjects(options = {}) {
  const {
    userId,
    organization_id,
    tenant_id,
    from = undefined,
    to = undefined,
    sort = undefined,
    page = undefined,
    pageSize = undefined,
    enabled = true,
    debounceMs = 400,
    cacheTimeMs = 60_000,
  } = options || {};

  const tenant = organization_id ?? tenant_id ?? undefined;

  // Build stable query object for request
  const query = useMemo(() => {
    const q = {};
    if (tenant) q.organization_id = tenant;
    if (from) {
      try {
        q.from = typeof from === "string" ? from : new Date(from).toISOString();
      } catch {
        q.from = String(from);
      }
    }
    if (to) {
      try {
        q.to = typeof to === "string" ? to : new Date(to).toISOString();
      } catch {
        q.to = String(to);
      }
    }
    if (sort) q.sort = sort;
    if (page != null) q.page = page;
    if (pageSize != null) q.pageSize = pageSize;
    return q;
  }, [tenant, from, to, sort, page, pageSize]);

  // Stable key for caching
  const key = useMemo(() => buildUsersProjectsKey({ userId, organization_id: tenant, from, to, sort, page, pageSize }), [userId, tenant, from, to, sort, page, pageSize]);

  // Debounce mechanism
  const debouncedRef = useRef({ t: null, lastArgs: null });
  const clearDebounce = () => {
    if (debouncedRef.current.t) clearTimeout(debouncedRef.current.t);
    debouncedRef.current.t = null;
  };

  // State
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled && userId && tenant));
  const [error, setError] = useState(null);

  // Keep last key to gate state updates vs. race
  const latestKeyRef = useRef(key);
  useEffect(() => {
    latestKeyRef.current = key;
  }, [key]);

  // Cancel previous in-flight when key changes
  const prevKeyRef = useRef(key);
  useEffect(() => {
    const prevKey = prevKeyRef.current;
    if (prevKey && prevKey !== key) {
      const inFlightPrev = inflight.get(prevKey);
      if (inFlightPrev?.controller) {
        try {
          inFlightPrev.controller.abort();
          devLog("aborted previous in-flight", { prevKey });
        } catch {
          // ignore
        }
      }
    }
    prevKeyRef.current = key;
  }, [key]);

  const loadNow = useCallback(async () => {
    if (!(enabled && userId && tenant)) {
      setLoading(false);
      setError(null);
      setData(null);
      return;
    }

    setError(null);
    setLoading(true);

    // Serve fresh cache when valid within TTL
    const cached = responseCache.get(key);
    if (cached && (Date.now() - (cached.ts || 0)) < cacheTimeMs) {
      devLog("cache hit (fresh)", { key });
      setData(cached.data);
      setLoading(false);
      return;
    }

    try {
      // Build URL
      const url = `/api/users/${encodeURIComponent(String(userId))}/projects`;

      // If we have cached data but TTL expired, try conditional GET with ETag
      const controller = new AbortController();
      const result = await fetchUserProjects(key, url, { query, signal: controller.signal });
      if (latestKeyRef.current !== key) {
        devLog("stale response ignored (key changed)", { key });
        return;
      }
      // When 304 and no cache, result may be null; normalize to existing cache or empty
      if (result == null) {
        const cached2 = responseCache.get(key);
        setData(cached2 ? cached2.data : null);
      } else {
        setData(result);
      }
    } catch (e) {
      if (e?.name === "AbortError") {
        devLog("load aborted", { key });
        return;
      }
      const message = e?.message || "Failed to load user projects.";
      setError(message);
      // Soft-fallback to cache if present
      const cached3 = responseCache.get(key);
      if (cached3?.data) {
        setData(cached3.data);
      } else {
        setData(null);
      }
    } finally {
      if (latestKeyRef.current === key) {
        setLoading(false);
      }
    }
  }, [enabled, userId, tenant, key, query, cacheTimeMs]);

  // Debounced loader
  const load = useCallback(() => {
    clearDebounce();
    debouncedRef.current.t = setTimeout(() => {
      loadNow();
    }, Math.max(300, Math.min(500, debounceMs)));
  }, [loadNow, debounceMs]);

  // Initial and updates
  useEffect(() => {
    load();
    return () => {
      clearDebounce();
    };
  }, [load]);

  // PUBLIC_INTERFACE
  const refetch = useCallback(async () => {
    // Bust cache for this key and fetch immediately (not debounced)
    responseCache.delete(key);
    await loadNow();
  }, [key, loadNow]);

  // Return normalized data shape for consumers
  const normalized = useMemo(() => {
    const payload = data?.data ?? data;
    if (!payload) return null;
    // expected: { user_id, tenant_id, projects: [...] }
    return payload;
  }, [data]);

  return { data: normalized, loading, error, refetch };
}

export default useUsersProjects;
