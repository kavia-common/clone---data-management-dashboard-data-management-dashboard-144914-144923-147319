import client from "./client";

/**
 * PUBLIC_INTERFACE
 * getSessionTracking
 * Wrapper for GET /api/session-tracking. Accepts query params such as:
 * - filter: JSON string containing MongoDB-style filter (e.g., {"organization_id":"org1","session_start":{"$gte":"...","$lte":"..."}})
 * - sort, page, limit
 */
export async function getSessionTracking(params = {}) {
  try {
    const res = await client.get("/api/session-tracking", { params });
    return res.data;
  } catch (err) {
    // Normalize error
    const message =
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.message ||
      "Failed to fetch session tracking";
    throw new Error(message);
  }
}
