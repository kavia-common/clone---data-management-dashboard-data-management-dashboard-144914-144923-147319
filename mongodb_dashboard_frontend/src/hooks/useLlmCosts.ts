import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type LlmCost = {
  _id: string;
  tenant_id?: string;
  organization_id?: string;
  user_id?: string | number;
  project_id?: string;
  llm_model?: string;
  provider?: string;
  service_type?: string;
  operation?: string;
  total_cost?: number | string;
  numeric_total_cost?: number;
  timestamp?: string;
  created_at?: string;
  updated_at?: string;
  breakdown?: { input_tokens?: number; output_tokens?: number };
};

type Envelope<T> = {
  success: boolean;
  data: T[];
  meta: { page: number; limit: number; total: number };
};

type Params = {
  organizationId?: string;
  page?: number;
  limit?: number;
  sort?: string;
  filter?: Record<string, any>;
  from?: string;
  to?: string;
};

type Result = {
  loading: boolean;
  error: string | null;
  items: LlmCost[];
  page: number;
  limit: number;
  total: number;
  refetch: (override?: Partial<Params>) => void;
  setQuery: (next: Partial<Params>) => void;
  query: Params;
};

const debounce = (fn: Function, ms: number) => {
  let t: any;
  return (...args: any[]) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

// PUBLIC_INTERFACE
export function useLlmCosts(initial: Params = {}): Result {
  /** This hook fetches /api/llm-costs with envelope support and cancels in-flight requests.
   *  - Debounces parameter changes by 300ms
   *  - Injects x-organization-id header if provided
   *  - Returns {items, page, limit, total}
   */
  const [items, setItems] = useState<LlmCost[]>([]);
  const [page, setPage] = useState<number>(initial.page || 1);
  const [limit, setLimit] = useState<number>(initial.limit || 20);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQueryState] = useState<Params>(initial);

  const abortRef = useRef<AbortController | null>(null);

  const buildUrl = useCallback((params: Params) => {
    const u = new URL('/api/llm-costs', window.location.origin);
    const p = new URLSearchParams();
    p.set('page', String(params.page ?? page));
    p.set('limit', String(params.limit ?? limit));
    if (params.sort) p.set('sort', params.sort);
    if (params.from) p.set('from', params.from);
    if (params.to) p.set('to', params.to);
    if (params.filter && Object.keys(params.filter).length) {
      p.set('filter', JSON.stringify(params.filter));
    }
    u.search = p.toString();
    return u.toString();
  }, [page, limit]);

  const performFetch = useCallback(async (params: Params) => {
    setLoading(true);
    setError(null);
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const url = buildUrl(params);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (params.organizationId) headers['x-organization-id'] = params.organizationId;
      const resp = await fetch(url, { headers, signal: controller.signal });
      const ct = resp.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        const text = await resp.text();
        throw new Error(`Unexpected response: ${resp.status} ${text.slice(0, 200)}`);
      }
      const json = await resp.json();
      // Accept both envelope and raw array (defensive)
      if (Array.isArray(json)) {
        setItems(json as LlmCost[]);
        setTotal(json.length);
        setPage(params.page ?? page);
        setLimit(params.limit ?? limit);
      } else {
        const env = json as Envelope<LlmCost>;
        setItems(env.data || []);
        setTotal(env.meta?.total || 0);
        setPage(env.meta?.page ?? params.page ?? page);
        setLimit(env.meta?.limit ?? params.limit ?? limit);
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError(e?.message || 'Failed to fetch LLM costs');
    } finally {
      setLoading(false);
    }
  }, [buildUrl, page, limit]);

  const debouncedFetch = useMemo(() => debounce(performFetch, 300), [performFetch]);

  const setQuery = useCallback((next: Partial<Params>) => {
    setQueryState(prev => {
      const merged = { ...prev, ...next };
      // update page/limit state immediately for UI
      if (typeof next.page === 'number') setPage(next.page);
      if (typeof next.limit === 'number') setLimit(next.limit);
      debouncedFetch(merged);
      return merged;
    });
  }, [debouncedFetch]);

  const refetch = useCallback((override?: Partial<Params>) => {
    const params = { ...query, ...(override || {}) };
    debouncedFetch(params);
  }, [query, debouncedFetch]);

  useEffect(() => {
    debouncedFetch({ ...query, page, limit });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { loading, error, items, page, limit, total, refetch, setQuery, query };
}
