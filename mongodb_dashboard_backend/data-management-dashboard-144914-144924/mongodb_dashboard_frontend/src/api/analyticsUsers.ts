import axios from './client';

/**
 * PUBLIC_INTERFACE
 * Fetch users activity time series.
 */
export async function fetchUsersActivity(params: {
  granularity?: 'daily' | 'weekly' | 'monthly';
  start?: string;
  end?: string;
  role?: 'all' | 'admin' | 'user';
  department?: string;
  status?: string;
  organization_id?: string;
}) {
  const res = await axios.get('/api/analytics/users/activity', { params });
  return res.data as {
    granularity: 'daily' | 'weekly' | 'monthly';
    start: string;
    end: string;
    buckets: { bucketStart: string; total: number; admin: number; user: number }[];
  };
}

/**
 * PUBLIC_INTERFACE
 * Fetch users active summary (DAU/WAU/MAU) with deltas.
 */
export async function fetchUsersSummary(window: 7 | 30 | 90 = 30) {
  const res = await axios.get('/api/analytics/users/summary', { params: { window } });
  return res.data as {
    window: number;
    dau: { value: number; changePct: number };
    wau: { value: number; changePct: number };
    mau: { value: number; changePct: number };
  };
}
