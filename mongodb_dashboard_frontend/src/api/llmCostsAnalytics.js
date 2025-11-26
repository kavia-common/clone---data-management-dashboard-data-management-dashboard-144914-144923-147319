import { getApiClient } from './baseClient';

/**
 * PUBLIC_INTERFACE
 * getLlmCostsOverTime
 * Stable implementation: derive costs over time using the supported list endpoint (/api/llm-costs)
 * and aggregate client-side by day/week/month. Returns:
 * { labels: string[], datasets: [{ label, data:number[] }], meta }
 *
 * Params:
 * - granularity: 'day' | 'week' | 'month' (default 'day')
 * - from: ISO datetime string (optional)
 * - to: ISO datetime string (optional)
 */
export async function getLlmCostsOverTime({ granularity = 'day', from, to } = {}) {
  const api = getApiClient();

  // 1) Fetch recent LLM cost records (paginate minimal; backend supports envelope with meta).
  // We request a larger page size to reduce round-trips; adjust if needed.
  let items = [];
  try {
    const res = await api.get('/api/llm-costs', {
      params: {
        // scope enforced by baseClient (organization_id) automatically
        limit: 1000,
        sort: '-timestamp',
      },
    });
    const payload = res?.data ?? {};
    // Normalize envelope vs raw array
    items = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : (payload?.items || []);
    // Defensive: ensure objects; drop nulls
    items = Array.isArray(items) ? items.filter(Boolean) : [];
  } catch (e) {
    // Non-fatal: return empty normalized structure
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[llmCostsAnalytics] fallback list fetch failed:', e?.message || e);
    }
    items = [];
  }

  // 2) Normalize date range
  const startDate = from ? new Date(from) : null;
  const endDate = to ? new Date(to) : null;
  const inRange = (d) => {
    if (!d) return false;
    const t = new Date(d);
    if (Number.isNaN(t.getTime())) return false;
    if (startDate && t < startDate) return false;
    if (endDate && t > endDate) return false;
    return true;
  };

  // 3) Helpers
  const toYMD = (d) => {
    const dt = new Date(d);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const da = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
  };
  const startOfWeek = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const diff = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - diff);
    return d;
  };
  const startOfMonth = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    return d;
  };
  const toNumber = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'string') {
      const n = Number(v.replace(/[$,]/g, ''));
      return Number.isFinite(n) ? n : 0;
    }
    if (v == null) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  // 4) Aggregate by bucket
  const buckets = new Map(); // key -> total USD
  (items || []).forEach((row) => {
    const ts = row.timestamp || row.date || row.created_at || row.updated_at;
    if (!inRange(ts)) return;
    let key;
    if (granularity === 'week') key = toYMD(startOfWeek(ts));
    else if (granularity === 'month') key = toYMD(startOfMonth(ts));
    else key = toYMD(ts); // day

    // Determine numeric cost fields
    const val = toNumber(row.total_cost ?? row.cost ?? row.amount ?? 0);
    buckets.set(key, (buckets.get(key) || 0) + val);
  });

  // 5) Build continuous series between from/to if provided, else sort known buckets
  let labels = [];
  let data = [];

  if (from && to) {
    const s = new Date(from);
    const e = new Date(to);
    if (granularity === 'week') {
      let c = startOfWeek(s);
      while (c <= e) {
        const k = toYMD(c);
        labels.push(k);
        data.push(toNumber(buckets.get(k) || 0));
        c = new Date(c);
        c.setDate(c.getDate() + 7);
      }
    } else if (granularity === 'month') {
      let c = startOfMonth(s);
      while (c <= e) {
        const k = toYMD(c);
        labels.push(k);
        data.push(toNumber(buckets.get(k) || 0));
        c = new Date(c);
        c.setMonth(c.getMonth() + 1);
      }
    } else {
      let c = new Date(s);
      c.setHours(0, 0, 0, 0);
      while (c <= e) {
        const k = toYMD(c);
        labels.push(k);
        data.push(toNumber(buckets.get(k) || 0));
        c = new Date(c);
        c.setDate(c.getDate() + 1);
      }
    }
  } else {
    // No explicit range: just return sorted aggregated buckets
    const entries = Array.from(buckets.entries()).sort(([a], [b]) => (a > b ? 1 : a < b ? -1 : 0));
    labels = entries.map(([k]) => k);
    data = entries.map(([, v]) => toNumber(v));
  }

  const meta = {
    granularity,
    from: from || null,
    to: to || null,
  };

  // Debug
  try {
    if (process?.env?.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.debug('[llmCostsAnalytics] client-aggregated over-time', {
        labels: labels.length,
        data: data.length,
        granularity: meta?.granularity,
      });
    }
  } catch {}

  return {
    labels,
    datasets: [
      {
        label: 'Total cost (USD)',
        data,
      },
    ],
    meta,
  };
}

const llmCostsAnalytics = { getLlmCostsOverTime };
export default llmCostsAnalytics;
