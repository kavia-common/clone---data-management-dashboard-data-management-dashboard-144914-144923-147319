import { useEffect, useRef, useState } from 'react';
import { getProjectName } from '../api/projectName';

// Simple in-memory caches at module scope
// Cache structure: Map<normalizedProjectId, { value: string|null, expiresAt: number }>
const nameCache = new Map();
// In-flight map to dedupe concurrent requests: Map<normalizedProjectId, Promise<string|null>>
const inflight = new Map();

// 5 minutes TTL in milliseconds
const TTL_MS = 5 * 60 * 1000;

/**
 * Normalize project id to a stable cache key string.
 * Ensures consistent keys even if numbers are passed.
 */
function normalizeKey(projectId) {
  if (projectId === null || projectId === undefined) return null;
  try {
    return String(projectId).trim();
  } catch {
    // Fallback to simple coercion
    return `${projectId}`;
  }
}

/**
 * Get from cache if valid (not expired), else null (meaning a fetch is needed).
 */
function getCachedName(key) {
  const entry = nameCache.get(key);
  if (!entry) return null;
  const now = Date.now();
  if (entry.expiresAt > now) {
    return entry.value;
  }
  // Expired - clean it up
  nameCache.delete(key);
  return null;
}

/**
 * Put a value into cache with TTL.
 */
function setCachedName(key, value) {
  nameCache.set(key, {
    value,
    expiresAt: Date.now() + TTL_MS,
  });
}

/**
 * Fetch the project name using the API client with deduplication via inflight map.
 * Ensures only one network call per key at a time.
 */
async function fetchProjectNameDedupe(key) {
  if (inflight.has(key)) {
    return inflight.get(key);
  }
  const p = (async () => {
    try {
      const { projectName } = await getProjectName(key);
      // Cache even null responses to avoid refetching for TTL duration
      setCachedName(key, projectName ?? null);
      return projectName ?? null;
    } finally {
      // Ensure inflight entry cleared regardless of success/failure
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

// PUBLIC_INTERFACE
export function useProjectName(projectId) {
  /**
   * Hook to resolve a project's friendly name from its id with 5-minute in-memory caching.
   * - Returns { projectName, loading, error }
   * - Deduplicates concurrent in-flight requests per projectId
   * - SSR-safe: does not assume window existence; uses useEffect for client-side fetch
   * - If projectId is null/undefined, returns neutral state without fetching
   */
  const key = normalizeKey(projectId);
  const [projectName, setProjectName] = useState(() => {
    // On initial render, try to synchronously read from cache (SSR-safe)
    if (!key) return null;
    const cached = getCachedName(key);
    return cached ?? null;
  });
  const [loading, setLoading] = useState(() => {
    if (!key) return false;
    const cached = getCachedName(key);
    return cached === null; // only loading if not cached
  });
  const [error, setError] = useState(null);

  // Track mounted status to avoid setting state after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // If no key, reset to neutral state
    if (!key) {
      setProjectName(null);
      setLoading(false);
      setError(null);
      return;
    }

    // If cached and valid, use it immediately and skip fetch
    const cached = getCachedName(key);
    if (cached !== null) {
      setProjectName(cached);
      setLoading(false);
      setError(null);
      return;
    }

    // Not cached: fetch with dedupe
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchProjectNameDedupe(key)
      .then((name) => {
        if (cancelled || !mountedRef.current) return;
        setProjectName(name ?? null);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || !mountedRef.current) return;
        // Do not cache errors; allow future retries on next render/change
        setError(err instanceof Error ? err : new Error('Failed to fetch project name'));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return { projectName, loading, error };
}

export default useProjectName;
