const isDev = typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production';

/**
 * Simple in-memory request cache with TTL.
 * Keys are full parameter keys (string).
 */
class RequestCache {
  constructor(defaultTtlMs = 60_000) {
    this.store = new Map(); // key -> { value, expiresAt }
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * Get cached value if not expired.
   * @param {string} key
   * @returns {any|null}
   */
  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      if (isDev) console.info('[requestCache] miss (no entry)', key);
      return null;
    }
    const now = Date.now();
    if (entry.expiresAt > now) {
      if (isDev) console.info('[requestCache] hit', key);
      return entry.value;
    }
    // expired
    this.store.delete(key);
    if (isDev) console.info('[requestCache] miss (expired)', key);
    return null;
  }

  /**
   * Set cache value with optional ttl.
   * @param {string} key
   * @param {any} value
   * @param {number} [ttlMs]
   */
  set(key, value, ttlMs) {
    const ms = typeof ttlMs === 'number' ? ttlMs : this.defaultTtlMs;
    this.store.set(key, { value, expiresAt: Date.now() + ms });
  }

  /**
   * Invalidate specific key
   * @param {string} key
   */
  invalidate(key) {
    this.store.delete(key);
  }

  /**
   * Clear all cache
   */
  clear() {
    this.store.clear();
  }
}

// Singleton cache used by sessions list fetching
export const requestCache = new RequestCache(60_000);

/**
 * Normalize a date or string date to minute precision ISO string.
 * e.g., '2025-01-01T12:34:56.789Z' -> '2025-01-01T12:34:00Z'
 * @param {string|Date|null|undefined} value
 * @returns {string|null}
 */
export function normalizeIsoMinute(value) {
  if (!value) return null;
  try {
    const d = value instanceof Date ? new Date(value) : new Date(String(value));
    if (isNaN(d.getTime())) return null;
    d.setSeconds(0, 0);
    return d.toISOString();
  } catch {
    return null;
  }
}

/**
 * Normalize string by trimming and converting empty to null.
 * @param {string|null|undefined} s
 * @returns {string|null}
 */
export function normalizeString(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  return t.length ? t : null;
}

/**
 * Build a stable params key from a params object.
 * Ensures sorted keys and normalized empty values so semantically
 * identical params produce identical keys.
 * @param {object} raw
 * @returns {string}
 */
export function buildStableParamsKey(raw) {
  const {
    tenant_id,
    page,
    limit,
    q,
    start,
    end,
    sortKey,
    sortDir,
  } = raw || {};

  const normalized = {
    tenant_id: normalizeString(tenant_id),
    page: Number.isFinite(page) ? page : (typeof page === 'string' && !isNaN(+page) ? +page : null),
    limit: Number.isFinite(limit) ? limit : (typeof limit === 'string' && !isNaN(+limit) ? +limit : null),
    q: normalizeString(q),
    start: normalizeIsoMinute(start),
    end: normalizeIsoMinute(end),
    sortKey: normalizeString(sortKey),
    sortDir: normalizeString(sortDir),
  };

  // produce stable JSON by sorting keys manually
  const ordered = {
    tenant_id: normalized.tenant_id,
    page: normalized.page,
    limit: normalized.limit,
    q: normalized.q,
    start: normalized.start,
    end: normalized.end,
    sortKey: normalized.sortKey,
    sortDir: normalized.sortDir,
  };

  return JSON.stringify(ordered);
}

/**
 * Shallow strict equality for two params keys
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 * @returns {boolean}
 */
export function paramsKeyEqual(a, b) {
  return a === b;
}
