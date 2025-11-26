import { getTenantUsersSummaryStrict } from "./index";

/**
 * PUBLIC_INTERFACE
 * getTenantUsersSummary
 * Fetch aggregated users by tenant summary.
 *
 * Important: Only organization_id must be sent as a query param.
 * Any provided filter-like params (from, to, status, includeInactive) will be ignored on purpose.
 *
 * Returns a normalized payload:
 * - { items: Array<{ tenant_id: string, tenant_name?: string|null, user_count: number }>, total?: number }
 *   or raw array fallback if backend returns array.
 *
 * Notes:
 * - Backend endpoint: GET /api/users/tenant-summary
 */
export async function getTenantUsersSummary() {
  try {
    const data = await getTenantUsersSummaryStrict();

    // Normalize shapes:
    if (data && Array.isArray(data.items)) {
      return { items: data.items, total: data.total ?? data.items.length };
    }
    if (Array.isArray(data)) {
      return { items: data, total: data.length };
    }
    // Pass-through minimal object
    if (data && typeof data === "object") {
      const items = Array.isArray(data.data) ? data.data : Array.isArray(data.items) ? data.items : [];
      return { items, total: data.total ?? items.length ?? 0 };
    }
    return { items: [], total: 0 };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[UsersAnalyticsAPI] getTenantUsersSummary failed:", err);
    // Surface a controlled error message; caller can show a toast or inline error
    throw new Error(err?.message || "Failed to load tenant users summary");
  }
}

/* No default export to favor named exports (lint rule) */
