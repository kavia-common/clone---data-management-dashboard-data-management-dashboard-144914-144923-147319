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
