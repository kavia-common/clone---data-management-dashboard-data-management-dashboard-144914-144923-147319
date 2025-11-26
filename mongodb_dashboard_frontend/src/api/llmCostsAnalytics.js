import { getApiBase } from './config';
import { getApiClient } from './baseClient';
import { getAuthContext } from './client';

/**
 * PUBLIC_INTERFACE
 * getLlmCostsOverTime
 * Fetch LLM costs aggregation over time from backend analytics endpoint and
 * normalize the response to { labels: string[], datasets: [{ label, data:number[] }], meta? }.
 *
 * Params:
 * - granularity: 'day' | 'week' | 'month' (default 'day')
 * - from: ISO datetime string (optional)
 * - to: ISO datetime string (optional)
 */
export async function getLlmCostsOverTime({ granularity = 'day', from, to } = {}) {
  const api = getApiClient();
  const base = getApiBase(); // ends with /api
  const qs = new URLSearchParams();
  if (granularity) qs.set('granularity', granularity);
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const url = `${base}/analytics/llm-costs/over-time?${qs.toString()}`;

  // Ensure tenant context is included for multi-tenant aware endpoints
  const { tenant_id } = getAuthContext();
  const headers = {};
  if (tenant_id) {
    headers['x-organization-id'] = tenant_id; // backend supports this header; alias to tenant
    headers['x-tenant-id'] = tenant_id; // keep x-tenant-id for consistency with other clients
  }

  const res = await api.get(url, { headers }).catch((e) => {
    // surface minimal, normalized debug info without throwing yet
    if (process.env.NODE_ENV !== 'production') {
      try {
        // eslint-disable-next-line no-console
        console.warn('[llmCostsAnalytics] GET failed, will normalize empty:', e?.message || e);
      } catch {}
    }
    return { data: {} };
  });
  const payload = res?.data ?? res ?? {};

  // Defensive normalization: accept both direct shape and enveloped
  let labels = [];
  if (Array.isArray(payload.labels)) {
    labels = payload.labels.map((l) => String(l));
  } else if (Array.isArray(payload.data?.labels)) {
    labels = payload.data.labels.map((l) => String(l));
  } else if (Array.isArray(payload.items)) {
    // Some backends return items: [{ date, total }] or similar
    labels = payload.items.map((it) => String(it?.date ?? it?.label ?? ''));
  }

  let rawDatasets = [];
  if (Array.isArray(payload.datasets)) {
    rawDatasets = payload.datasets;
  } else if (Array.isArray(payload.data?.datasets)) {
    rawDatasets = payload.data.datasets;
  } else if (Array.isArray(payload.items)) {
    // Build dataset from items fallback if datasets missing
    const itemData = payload.items.map((it) => it?.total ?? it?.value ?? it?.amount ?? it?.cost ?? 0);
    rawDatasets = [{ label: 'Total cost (USD)', data: itemData }];
  }

  const first = rawDatasets.length > 0 ? rawDatasets[0] : null;

  // Determine raw data array with safe fallbacks
  let rawData = [];
  if (Array.isArray(first?.data)) {
    rawData = first.data;
  } else if (Array.isArray(payload.data)) {
    rawData = payload.data;
  } else if (Array.isArray(payload.items)) {
    rawData = payload.items.map((it) => it?.total ?? it?.value ?? it?.amount ?? it?.cost ?? 0);
  }

  // Coerce values to finite numbers (strip currency symbols if needed)
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
  const data = rawData.map(toNumber);

  // If analytics returned nothing, keep empty arrays to let caller decide on fallback
  // Else, trim to the shorter length to avoid chart issues
  const len = Math.min(labels.length, data.length);
  const normLabels = len ? labels.slice(0, len) : labels;
  const normData = len ? data.slice(0, len) : data;

  // If payload has costs_by_date shape: { 'YYYY-MM-DD': number|string }
  if (!normLabels.length && !normData.length && payload && typeof payload === 'object' && payload.costs_by_date) {
    const entries = Object.entries(payload.costs_by_date || {});
    // sort by date key asc
    entries.sort(([a], [b]) => (a > b ? 1 : a < b ? -1 : 0));
    const altLabels = entries.map(([k]) => String(k));
    const altData = entries.map(([, v]) => toNumber(v));
    const L = Math.min(altLabels.length, altData.length);
    labels = altLabels.slice(0, L);
    rawDatasets = [{ label: 'Total cost (USD)', data: altData.slice(0, L) }];
  }

  const meta = payload.meta || payload.data?.meta || {
    granularity,
    from: from || null,
    to: to || null,
  };

  // Helpful debug in development builds
  try {
    if (process?.env?.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.debug('[llmCostsAnalytics] normalized over-time', {
        url,
        labels: (labels || normLabels).length,
        data: (rawDatasets?.[0]?.data || normData).length,
        granularity: meta?.granularity,
      });
    }
  } catch (_) {
    // ignore
  }

  // Final normalized return (ensure arrays present and aligned)
  const finalLabels = labels?.length ? labels : normLabels;
  const finalData = (rawDatasets?.[0]?.data?.length ? rawDatasets[0].data : normData).map(toNumber);
  const finalLen = Math.min(finalLabels.length, finalData.length);
  const outLabels = finalLabels.slice(0, finalLen);
  const outData = finalData.slice(0, finalLen);

  return {
    labels: outLabels,
    datasets: [
      {
        label: (rawDatasets?.[0]?.label) || 'Total cost (USD)',
        data: outData,
      },
    ],
    meta,
  };
}

const llmCostsAnalytics = { getLlmCostsOverTime };
export default llmCostsAnalytics;
