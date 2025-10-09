import { getApiClient } from "./client";

/**
 * PUBLIC_INTERFACE
 * Fetch the full-range "new users over time" analytics with no granularity parameter.
 * The backend defaults to daily aggregation across the full available range when no granularity is provided.
 * Expected response shape: { items: [{ date: "YYYY-MM-DD", total: number }], meta?: any }
 */
export async function fetchNewUsersOverTime() {
  try {
    const api = getApiClient();
    const res = await api.get(`/analytics/users/new-over-time`);
    // Normalize potential raw array responses to { items }
    if (Array.isArray(res.data)) {
      return { items: res.data };
    }
    return res.data;
  } catch (err) {
    const message =
      err?.response?.data?.message ||
      err?.message ||
      "Failed to load new users over time";
    throw new Error(message);
  }
}
