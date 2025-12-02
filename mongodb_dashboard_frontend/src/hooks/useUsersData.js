import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listUsers } from "../api";
import useDebouncedValue from "./useDebouncedValue";

/**
 * PUBLIC_INTERFACE
 * buildUsersQueryKey
 * Builds a stable query key string for caching users list responses.
 *
 * @param {{ page?: number, limit?: number, sort?: string, filter?: any, search?: string }} params
 * @returns {string}
 */
export function buildUsersQueryKey(params = {}) {
  const { page, limit, sort, filter, search } = params || {};
  // Only keys relevant to /api/users (backend may ignore some, but we include for semantic caching)
  const keyObj = {
    page: page ?? null,
    limit: limit ?? null,
    sort: sort ?? null,
    filter: typeof filter === "string" ? filter : filter ? JSON.stringify(filter) : null,
    search: search ?? null,
  };
  return `users:${JSON.stringify(keyObj)}`;
}

// Simple in-memory cache for memoized responses and in-flight requests
const responseCache = new Map(); // key -> { items, total, meta, ts }
const inflightMap = new Map();   // key -> { controller: AbortController, promise: Promise }

/**
 * Internal: fetch users with cancellation and caching.
 * - Dedupes simultaneous identical requests.
 * - Caches successful responses by query key.
 * - Cancels previous in-flight for same key on new fetch.
 */
async function fetchUsersOnce(key, params) {
  // If a response is cached, return it immediately
  if (responseCache.has(key)) {
    return responseCache.get(key);
  }

  // If there is an in-flight request for this key, await it
  const existing = inflightMap.get(key);
  if (existing?.promise) {
    return existing.promise;
  }

  // Start a new request
  const controller = new AbortController();
  const promise = (async () => {
    try {
      const res = await listUsers(params, { signal: controller.signal });
      const normalized = {
        items: res?.items || (Array.isArray(res) ? res : []),
        total: res?.total ?? (Array.isArray(res?.items) ? res.items.length : Array.isArray(res) ? res.length : 0),
        meta: res?.meta || null,
      };
      // Cache success
      responseCache.set(key, { ...normalized, ts: Date.now() });
      return normalized;
    } finally {
      // Clear inflight entry when settled
      const cur = inflightMap.get(key);
      if (cur && cur.controller === controller) {
        inflightMap.delete(key);
      }
    }
  })();

  inflightMap.set(key, { controller, promise });
  return promise;
}

/**
 * PUBLIC_INTERFACE
 * useUsersData
 * Memoized, debounced query layer for listing users.
 *
 * Strategy:
 * - Batches filter criteria into one request via params.
 * - Caches responses per stable query key (page, limit, sort, filter, search).
 * - Avoids per-record fetches by returning all fields from /api/users; consumers should read from row data.
 * - Cancels in-flight requests on parameter changes; dedupes identical queries.
 *
 * @param {{ page?: number, limit?: number, sort?: string, filter?: any, search?: string, debounceMs?: number, cacheTimeMs?: number }} options
 * @returns {{ items: any[], total: number, loading: boolean, error: string|null, refetch: () => Promise<void> }}
 */
export default function useUsersData(options = {}) {
  const {
    page = 1,
    limit = 20,
    sort,
    filter,
    search,
    debounceMs = 250,
    cacheTimeMs = 30_000, // cache TTL for soft-staleness
  } = options || {};

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Build raw params for request. Note: baseClient sanitizes what actually gets sent.
  const rawParams = useMemo(() => {
    const out = {};
    if (page != null) out.page = page;
    if (limit != null) out.limit = limit;
    if (sort) out.sort = sort;
    if (search) out.q = search; // downstream supports q in some modules; harmless if ignored
    if (filter) out.filter = typeof filter === "string" ? filter : JSON.stringify(filter);
    return out;
  }, [page, limit, sort, search, filter]);

  const debouncedParams = useDebouncedValue(rawParams, debounceMs);
  const key = useMemo(() => buildUsersQueryKey({ page, limit, sort, filter, search }), [page, limit, sort, filter, search]);

  // Keep track of the latest key for safety
  const latestKeyRef = useRef(key);
  useEffect(() => { latestKeyRef.current = key; }, [key]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Validate cache age
      const cached = responseCache.get(key);
      if (cached && (Date.now() - (cached.ts || 0)) < cacheTimeMs) {
        setItems(cached.items || []);
        setTotal(cached.total || 0);
        return;
      }
      const res = await fetchUsersOnce(key, debouncedParams);
      // Only set if this is still the latest request for current state
      if (latestKeyRef.current === key) {
        setItems(res.items || []);
        setTotal(res.total || 0);
      }
    } catch (e) {
      if (e?.name === "AbortError") return;
      setError(e?.message || "Failed to load users.");
      setItems([]);
      setTotal(0);
    } finally {
      if (latestKeyRef.current === key) {
        setLoading(false);
      }
    }
  }, [key, debouncedParams, cacheTimeMs]);

  // Cancel any in-flight request when params change by aborting previous key's controller
  const prevKeyRef = useRef(key);
  useEffect(() => {
    const prevKey = prevKeyRef.current;
    if (prevKey && prevKey !== key) {
      const inflight = inflightMap.get(prevKey);
      if (inflight?.controller) {
        try { inflight.controller.abort(); } catch { /* ignore */ }
      }
    }
    prevKeyRef.current = key;
  }, [key]);

  // Execute load on debounced param changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [load]);

  // PUBLIC_INTERFACE
  const refetch = useCallback(async () => {
    // Bust cache for this key and re-run
    responseCache.delete(key);
    await load();
  }, [key, load]);

  return { items, total, loading, error, refetch };
}

/**
 * PUBLIC_INTERFACE
 * clearUsersCache
 * Utility to clear the users response cache (e.g., after mutations).
 */
export function clearUsersCache() {
  responseCache.clear();
}
