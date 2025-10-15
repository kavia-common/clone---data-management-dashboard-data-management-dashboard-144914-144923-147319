import axios from "axios";
import { getApiBase } from "./config";

/**
 * PUBLIC_INTERFACE
 * getActiveUsersTrend
 * Fetch active users trend from backend.
 * @param {{ from?: string, to?: string, status?: string, tenant_id?: string, granularity?: 'day'|'week'|'month' }} params
 * @returns {Promise<{ items: Array<{ date: string, total: number }>, meta?: any }>}
 */
export async function getActiveUsersTrend(params = {}) {
  const base = getApiBase();
  const url = `${base}/users/active-trend`;
  const res = await axios.get(url, { params });
  return res.data;
}

export default { getActiveUsersTrend };
