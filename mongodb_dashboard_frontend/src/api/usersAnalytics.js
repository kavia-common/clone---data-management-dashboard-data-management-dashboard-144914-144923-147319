import { getApiClient } from "./baseClient";
import { buildCreatedAtDateOnlyFilter } from "../services/usersService";

/**
 * PUBLIC_INTERFACE
 * getTenantUsersSummary
 * Aggregates users by tenant from /api/users.
 * Always includes organization_id (auto-attached by base client) and accepts the same time params as buildCreatedAtDateOnlyFilter.
 *
 * Returns:
 *  { items: Array<{ tenant_id: string, tenant_name?: string|null, user_count: number }>, total: number }
 */
export async function getTenantUsersSummary({
  mode = "daily",
  selectedDate,
  selectedWeekAnchor,
  selectedMonthAnchor,
  customFrom,
  customTo,
  limit = 1000,
} = {}) {
  const api = getApiClient();

  const createdAtFilter = buildCreatedAtDateOnlyFilter({
    mode,
    selectedDate,
    selectedWeekAnchor,
    selectedMonthAnchor,
    customFrom,
    customTo,
  });

  const params = {
    mode,
    limit,
    ...(createdAtFilter ? { filter: createdAtFilter } : {}),
  };

  const res = await api.get("/api/users", { params });
  const payload = res?.data;
  const users = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.items)
    ? payload.items
    : [];

  // Aggregate by tenant
  const map = new Map();
  for (const u of users) {
    const tenant_id = u.tenant_id || u.organization_id || "unknown";
    const tenant_name = u.tenant_name || u.organization_name || tenant_id;
    const prev = map.get(tenant_id) || { tenant_id, tenant_name, user_count: 0 };
    prev.user_count += 1;
    map.set(tenant_id, prev);
  }
  const items = Array.from(map.values()).sort((a, b) => b.user_count - a.user_count);
  return { items, total: items.length };
}

/* No default export to favor named exports */
