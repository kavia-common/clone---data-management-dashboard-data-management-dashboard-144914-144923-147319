import { getApiClient } from "./client";

/**
 * PUBLIC_INTERFACE
 * Fetch "new users over time" analytics.
 * @param {"day"|"week"|"month"} granularity
 * @returns {Promise<{ items: Array<{ date: string, total: number }>, meta?: any }>}
 */
export async function fetchNewUsersOverTime(granularity = "day") {
  // Validate granularity
  const g = ["day", "week", "month"].includes(granularity) ? granularity : "day";
  try {
    const api = getApiClient();
    const res = await api.get(`/analytics/users/new-over-time?granularity=${g}`);
    // Expect either { items: [...] } or raw array fallback
    if (Array.isArray(res.data)) {
      return { items: res.data };
    }
    return res.data;
  } catch (err) {
    // Normalize error for caller
    const message =
      err?.response?.data?.message ||
      err?.message ||
      "Failed to load new users over time";
    throw new Error(message);
  }
}
