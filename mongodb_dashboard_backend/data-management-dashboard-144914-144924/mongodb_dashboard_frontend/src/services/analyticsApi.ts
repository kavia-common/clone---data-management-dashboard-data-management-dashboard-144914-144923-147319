import axios from 'axios';

export type FeatureSeriesPoint = { t: string; count: number };
export type FeatureSeries = { name: string; totalCount: number; series: FeatureSeriesPoint[] };

export type FeatureUsageResponse = {
  serviceType: string | null;
  range: { from: string; to: string };
  interval: 'day' | 'week';
  features: FeatureSeries[];
  mostUsed: string | null;
  leastUsed: string | null;
};

// PUBLIC_INTERFACE
export async function fetchFeatureUsage(params: {
  serviceType?: string;
  from?: string;
  to?: string;
  interval?: 'day' | 'week';
}): Promise<FeatureUsageResponse> {
  /** Fetch feature usage analytics from backend. */
  const res = await axios.get('/api/analytics/feature-usage', { params });
  return res.data as FeatureUsageResponse;
}

// PUBLIC_INTERFACE
export async function fetchSessionsByType(params?: {
  from?: string;
  to?: string;
  granularity?: 'day' | 'week' | 'month';
  tenant_id?: string;
}): Promise<{ success: boolean; items: Array<{ date: string; series: Record<string, number>; total: number }>; meta: { from: string; to: string; granularity: string; types: string[]; bucketCount: number } }> {
  const { from, to, granularity = 'day', tenant_id } = params || {};
  try {
    const res = await axios.get('/api/analytics/sessions-by-type', {
      params: { from, to, granularity, tenant_id },
    });
    return res.data;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('fetchSessionsByType error', e);
    throw e;
  }
}
