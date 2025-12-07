import client from "./client";

/**
 * PUBLIC_INTERFACE
 * getSessionTracking
 * Wrapper for GET /api/session-tracking.
 * Params:
 * - filter: object or JSON string; when object, it will be JSON.stringified by the base client.
 * - sort?: string (e.g., "-session_start")
 * - page?: number
 * - limit?: number
 * Returns: payload as returned by backend (array or envelope). Consumers should normalize as needed.
 */
export async function getSessionTracking(params = {}) {
  try {
    const res = await client.get("/api/session-tracking", { params });
    return res.data;
  } catch (err) {
    const message =
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.message ||
      "Failed to fetch session tracking";
    throw new Error(message);
  }
}
