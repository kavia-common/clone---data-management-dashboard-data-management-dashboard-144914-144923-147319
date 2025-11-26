import { getApiBase } from './config';
import { getApiClient } from './baseClient';

/**
 * PUBLIC_INTERFACE
 * getLlmCostsOverTime
 * Fetch LLM costs aggregation over time from backend analytics endpoint.
 *
 * Params:
 * - organization_id: string (auto-injected by base client; optional here)
 * - granularity: 'day' | 'week' | 'month' (default 'day')
 * - from: ISO datetime string (optional)
 * - to: ISO datetime string (optional)
 *
 * Returns:
 *   {
 *     labels: string[],
 *     datasets: [{ label: string, data: number[] }],
 *     meta?: { granularity?: string, from?: string, to?: string }
 *   }
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
  // baseClient already throws on !ok and returns { data }
  return res?.data ?? res;
}

const llmCostsAnalytics = { getLlmCostsOverTime };
export default llmCostsAnalytics;
