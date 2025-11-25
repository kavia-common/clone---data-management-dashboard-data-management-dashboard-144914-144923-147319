# Overview Users Trend - Monthly Granularity

This backend supports monthly granularity for the Overview "Users over time" trend endpoint.
Monthly buckets use start-of-month (UTC) boundaries and return labels in the format YYYY-MM.
Day and week granularities remain unaffected and continue to return labels in YYYY-MM-DD.

Endpoint:
GET /api/overview/users-trend

Query parameters:
- from: ISO date-time (inclusive lower bound)
- to: ISO date-time (exclusive upper bound for bucketing, inclusive for query filtering)
- granularity: day | week | month
- status: active | deleted (default: active)

Sample request to verify monthly buckets and partial month handling:
GET /api/overview/users-trend?granularity=month&from=2024-01-05T00:00:00.000Z&to=2024-04-20T00:00:00.000Z

Expected behavior:
- Buckets emitted: ["2024-01", "2024-02", "2024-03", "2024-04"]
- Each bucket counts users using created_at/updated_at with deletion rules:
  - status=active (default): counts users created/updated within range and not deleted (status !== 'deleted' and no deleted_at)
  - status=deleted: counts by deleted_at in range or status='deleted' with updated_at in range
- If the range spans partial months only (e.g., within a single calendar month), the API returns at least one bucket for that month.
- Day/week behavior remains unchanged.

Notes:
- Tenant scoping is enforced via middleware (tenantScope). If present, only users for the resolved tenant are aggregated.
- Labels:
  - granularity=month -> YYYY-MM
  - granularity=week -> YYYY-MM-DD (start of ISO week)
  - granularity=day -> YYYY-MM-DD
