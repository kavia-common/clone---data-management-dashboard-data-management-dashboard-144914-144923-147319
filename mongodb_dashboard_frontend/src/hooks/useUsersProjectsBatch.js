import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getUsersProjectsBatch } from '../api/usersProjectsBatchClient';

/**
 * PUBLIC_INTERFACE
 * buildUsersProjectsBatchKey
 * Build a stable cache key for batched users projects query.
 */
export function buildUsersProjectsBatchKey({ userIds = [], organization_id, tenant_id, from, to } = {}) {
  const tenant = organization_id ?? tenant_id ?? null;
  const ids = Array.from(new Set((userIds || []).filter(Boolean).map(String))).sort();
  const key = {
    userIds: ids,
    tenant,
    from: from ? (typeof from === 'string' ? from : new Date(from).toISOString()) : null,
    to: to ? (typeof to === 'string' ? to : new Date(to).toISOString()) : null,
  };
  return `usersProjectsBatch:${JSON.stringify(key)}`;
}

// In-memory caches and in-flight registry for batch hook
const responseCache = new Map(); // key -> { data(Map), ts }
const inflight = new Map(); // key -> { controller, promise }

// Dev log
function devLog(...args) {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.debug('[useUsersProjectsBatch]', ...args);
  }
}

/**
 * PUBLIC_INTERFACE
 * useUsersProjectsBatch
 * Fetch projects for many users once, returning a map { [userId]: projects[] }.
 * Features:
 * - Deduplication and in-flight reuse by stable key
 * - Debounce to absorb rapid filter changes
 * - Simple TTL cache
 * - In-flight cancellation
 */
export default function useUsersProjectsBatch(options = {}) {
  const {
    userIds = [],
    organization_id,
    tenant_id,
    from,
    to,
    enabled = true,
    debounceMs = 300,
    cacheTimeMs = 60_000,
  } = options || {};

  const ids = useMemo(
    () => Array.from(new Set((userIds || []).filter(Boolean).map(String))),
    [userIds]
  );
  const tenant = organization_id ?? tenant_id ?? undefined;

  const key = useMemo(
    () => buildUsersProjectsBatchKey({ userIds: ids, organization_id: tenant, from, to }),
    [ids, tenant, from, to]
  );

  const [data, setData] = useState({});
  const [loading, setLoading] = useState(Boolean(enabled && ids.length > 0 && tenant));
  const [error, setError] = useState(null);

  const latestKeyRef = useRef(key);
  useEffect(() => { latestKeyRef.current = key; }, [key]);

  // cancel previous in-flight for old key
  const prevKeyRef = useRef(key);
  useEffect(() => {
    const prevKey = prevKeyRef.current;
    if (prevKey && prevKey !== key) {
      const cur = inflight.get(prevKey);
      if (cur?.controller) {
        try { cur.controller.abort(); } catch { /* ignore */ }
      }
    }
    prevKeyRef.current = key;
  }, [key]);

  const loadNow = useCallback(async () => {
    if (!(enabled && ids.length > 0 && tenant)) {
      setLoading(false);
      setError(null);
      setData({});
      return;
    }

    // serve fresh cache if within TTL
    const cached = responseCache.get(key);
    if (cached && (Date.now() - (cached.ts || 0)) < cacheTimeMs) {
      devLog('cache hit', { key, userIds: ids.length });
      setData(cached.data || {});
      setLoading(false);
      setError(null);
      return;
    }

    // dedupe in-flight
    const existing = inflight.get(key);
    if (existing?.promise) {
      devLog('reuse in-flight', { key });
      try {
        const res = await existing.promise;
        if (latestKeyRef.current === key) {
          setData(res || {});
          setError(null);
          setLoading(false);
        }
      } catch (e) {
        if (e?.name !== 'AbortError') setError(e?.message || 'Failed to load user projects');
        if (latestKeyRef.current === key) setLoading(false);
      }
      return;
    }

    const controller = new AbortController();
    const promise = (async () => {
      try {
        const resp = await getUsersProjectsBatch({
          userIds: ids,
          organization_id: tenant,
          from,
          to,
        });
        const map = resp?.data && typeof resp.data === 'object' ? resp.data : {};
        responseCache.set(key, { data: map, ts: Date.now() });
        return map;
      } finally {
        const cur = inflight.get(key);
        if (cur && cur.controller === controller) inflight.delete(key);
      }
    })();
    inflight.set(key, { controller, promise });

    setLoading(true);
    setError(null);
    try {
      const map = await promise;
      if (latestKeyRef.current === key) {
        setData(map || {});
        setLoading(false);
      }
    } catch (e) {
      if (e?.name === 'AbortError') return;
      if (latestKeyRef.current === key) {
        setError(e?.message || 'Failed to load user projects');
        setLoading(false);
      }
    }
  }, [enabled, ids, tenant, from, to, key, cacheTimeMs]);

  // debounce
  const debounceRef = useRef(null);
  const load = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(loadNow, Math.max(200, Math.min(600, debounceMs)));
  }, [loadNow, debounceMs]);

  useEffect(() => {
    load();
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [load]);

  // PUBLIC_INTERFACE
  const refetch = useCallback(async () => {
    responseCache.delete(key);
    await loadNow();
  }, [key, loadNow]);

  return { data, loading, error, refetch };
}
