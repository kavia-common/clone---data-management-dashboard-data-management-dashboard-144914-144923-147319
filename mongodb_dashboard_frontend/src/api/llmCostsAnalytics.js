import { getApiBase } from './config';
import { getApiClient } from './baseClient';

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

  const res = await api.get(url);
  const payload = res?.data ?? res ?? {};

  // Defensive normalization: accept both direct shape and enveloped
  const labels = Array.isArray(payload.labels)
    ? payload.labels.map((l) => String(l))
    : Array.isArray(payload.data?.labels)
    ? payload.data.labels.map((l) => String(l))
    : [];

  const rawDatasets = Array.isArray(payload.datasets)
    ? payload.datasets
    : Array.isArray(payload.data?.datasets)
    ? payload.data.datasets
    : [];

  const first = rawDatasets.length > 0 ? rawDatasets[0] : null;
  const rawData = Array.isArray(first?.data)
    ? first.data
    : Array.isArray(payload.data)
    ? payload.data
    : [];

  // Coerce values to finite numbers (strip currency symbols if needed)
  const toNumber = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'string') {
      const n = Number(v.replace(/[$,]/g, ''));
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  };
  const data = rawData.map(toNumber);

  // If lengths mismatch, trim to the shorter length to avoid chart issues
  const len = Math.min(labels.length, data.length);
  const normLabels = len ? labels.slice(0, len) : labels;
  const normData = len ? data.slice(0, len) : data;

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
        labels: normLabels.length,
        data: normData.length,
        granularity: meta?.granularity,
      });
    }
  } catch (_) {
    // ignore
  }

  return {
    labels: normLabels,
    datasets: [
      {
        label: first?.label || 'Total cost (USD)',
        data: normData,
      },
    ],
    meta,
  };
}

const llmCostsAnalytics = { getLlmCostsOverTime };
export default llmCostsAnalytics;
