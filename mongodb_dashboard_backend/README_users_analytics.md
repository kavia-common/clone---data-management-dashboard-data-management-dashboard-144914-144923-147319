# Users Analytics (v2)

## Overview

This document describes the Users Analytics API under the base path `/api/users/analytics`, including filters, response shapes designed for charts/KPIs/tables, UI usage notes, index recommendations, environment configuration, and known limitations. All information is synchronized with the current codebase implementation found in `src/routes/users.analytics.routes.v2.js` and related routes.

## Base Path

- Base path: `/api/users/analytics`

## Common Query Parameters

All endpoints under `/api/users/analytics` accept the following filters unless otherwise noted:

- `organization_id` (string): Filters to a specific organization/tenant id when present. Optional.
- `department` (string): Filters to a specific department when present. Optional.
- `status` (string): Filters users by status. For engagement endpoints, defaults to `active` if not provided.
- `from` (ISO string): Lower bound of the date range. Inclusive. Optional unless specified by the endpoint.
- `to` (ISO string): Upper bound of the date range. For bucketing, treated as exclusive upper bound; in some aggregations it is applied inclusively as implemented. Optional unless specified by the endpoint.

Unless otherwise specified, time handling is in UTC. Missing `from`/`to` default windows are chosen per endpoint to provide sensible views.

### Example query strings

- Filter by organization and time window:
  - `/api/users/analytics/activity-trends?organization_id=org_123&from=2025-01-01T00:00:00.000Z&to=2025-02-01T00:00:00.000Z`
- Filter by department and default active status:
  - `/api/users/analytics/activity-breakdown?department=Engineering`
- Explicitly override default status:
  - `/api/users/analytics/top-active-users?status=inactive&limit=20`

## Endpoints

### 1) GET /api/users/analytics/activity-trends

- Summary: Daily active users with DAU/WAU/MAU and time series per day.
- Filters: `organization_id`, `department`, `status` (defaults to `active`), `from`, `to`
- Defaults: If no dates provided, a default 30-day window is applied on `updated_at`.
- Activity proxy: Uses `updated_at` field as activity signal.

Response shape:
- 200 OK
```
{
  "meta": {
    "from": "2025-01-01T00:00:00.000Z",
    "to": "2025-02-01T00:00:00.000Z",
    "organization_id": "org_123" | null,
    "department": "Engineering" | null,
    "status": "active"
  },
  "kpis": {
    "DAU": 42,
    "WAU": 168,
    "MAU": 420
  },
  "series": [
    { "date": "2025-01-01", "value": 12 },
    { "date": "2025-01-02", "value": 15 }
  ],
  "notes": [
    "Defaults to status=active for engagement unless overridden.",
    "Index recommended: { updated_at: 1 }, { created_at: 1 }, and optionally compound with organization_id/department."
  ]
}
```

Chart usage:
- Use `series` for a daily line chart (x = `date`, y = `value`).
- Display DAU/WAU/MAU as KPI tiles.

### 2) GET /api/users/analytics/growth

- Summary: New users aggregated by granularity with period-over-period growth rate.
- Filters: `organization_id`, `department`, `status` (optional), `from`, `to`, `granularity` = `day|week|month` (default `day`)
- Growth basis: Uses `created_at`.

Response shape:
```
{
  "meta": {
    "from": "2025-01-01T00:00:00.000Z",
    "to": "2025-02-01T00:00:00.000Z",
    "granularity": "day",
    "organization_id": null,
    "department": null,
    "status": null
  },
  "series": [
    { "label": "2025-01-01", "value": 5 },
    { "label": "2025-01-02", "value": 8 }
  ],
  "totals": {
    "totalNew": 320,
    "previousPeriod": 280
  },
  "growthRate": 0.14285714285714285,
  "notes": [
    "Index recommended: { created_at: 1 }",
    "For chart gaps, client can fill missing intervals."
  ]
}
```

Chart usage:
- Use `series` for a line/bar chart of new users.
- `growthRate` can be displayed as a KPI with period-over-period trend.

### 3) GET /api/users/analytics/activity-breakdown

- Summary: Active users by department and by organization.
- Filters: `organization_id`, `department`, `status` (defaults to `active`), `from`, `to`
- Activity proxy: Uses `updated_at`.

Response shape:
```
{
  "meta": {
    "from": "2025-01-01T00:00:00.000Z",
    "to": "2025-02-01T00:00:00.000Z",
    "organization_id": null,
    "department": null,
    "status": "active"
  },
  "byDepartment": [
    { "label": "Engineering", "count": 24 },
    { "label": "Sales", "count": 10 }
  ],
  "byOrganization": [
    { "label": "org_123", "count": 30 },
    { "label": "org_456", "count": 12 }
  ],
  "notes": [
    "Indexes: { updated_at: 1 }, { department: 1 }, { organization_id: 1 }"
  ]
}
```

Chart usage:
- Use `byDepartment` for a horizontal/vertical bar chart.
- `byOrganization` is suitable for a comparison bar or table.

### 4) GET /api/users/analytics/inactivity

- Summary: Counts by inactivity thresholds and active/inactive ratio (computed relative to “now”; does not require from/to).
- Filters: `organization_id`, `department`
- Inactivity basis: `updated_at`.

Response shape:
```
{
  "meta": {
    "asOf": "2025-02-01T12:34:56.000Z",
    "organization_id": null,
    "department": null
  },
  "thresholds": {
    "gt7": 12,
    "gt14": 8,
    "gt30": 4,
    "gt60": 2,
    "gt90": 1
  },
  "totals": {
    "active": 40,
    "inactive": 10,
    "total": 50
  },
  "ratio": {
    "activeToInactive": 4
  },
  "notes": [
    "Indexes: { updated_at: 1 } help inactivity queries."
  ]
}
```

Visualization:
- Render thresholds as a small multiples bar chart or a table.
- Show active vs inactive as a donut/pie and display the ratio KPI.

### 5) GET /api/users/analytics/compliance

- Summary: Acceptance compliance—percent accepted and average time-to-accept (if `accepted_at` is present).
- Filters: `organization_id`, `department`, `from`, `to`
- Denominator window: Users filtered by `created_at` within the window. Acceptance must have `accepted_at`.

Response shape:
```
{
  "meta": {
    "from": "2025-01-01T00:00:00.000Z",
    "to": "2025-02-01T00:00:00.000Z",
    "organization_id": null,
    "department": null
  },
  "percentAccepted": 0.85,
  "avgTimeToAcceptDays": 3.2,
  "series": [
    { "label": "2025-01-06", "value": 0.7 },
    { "label": "2025-01-13", "value": 0.88 }
  ],
  "notes": [
    "Assumes users.accepted_at exists when acceptance happens.",
    "Indexes: { created_at: 1 }, { accepted_at: 1 }."
  ]
}
```

Visualization:
- Show `percentAccepted` and `avgTimeToAcceptDays` as KPIs.
- Use `series` for a weekly acceptance rate line chart.

### 6) GET /api/users/analytics/retention-cohorts

- Summary: Monthly cohorts based on `created_at` month with 7/30/90-day activity rates using `updated_at`.
- Filters: `organization_id`, `department`, `from`, `to`

Response shape:
```
{
  "meta": {
    "from": "2024-02-01T00:00:00.000Z",
    "to": "2025-02-01T00:00:00.000Z",
    "organization_id": null,
    "department": null
  },
  "items": [
    { "cohort": "2024-12", "size": 120, "d7": 0.45, "d30": 0.35, "d90": 0.28 },
    { "cohort": "2025-01", "size": 80, "d7": 0.52, "d30": 0.4, "d90": 0.31 }
  ],
  "notes": [
    "Retention uses updated_at as activity proxy.",
    "Indexes: { created_at: 1 }, { updated_at: 1 } recommended."
  ]
}
```

Visualization:
- Use a retention table or heatmap (cohorts as rows, d7/d30/d90 as columns).
- Optionally combine with sparkline per cohort.

### 7) GET /api/users/analytics/top-active-users

- Summary: Top active users based on most recent `updated_at`. Supports `limit` query parameter.
- Filters: `organization_id`, `department`, `status` (defaults to `active`), `from`, `to`, `limit`
- Activity proxy: `updated_at`.

Response shape:
```
{
  "meta": {
    "from": "2025-01-02T00:00:00.000Z",
    "to": "2025-02-01T00:00:00.000Z",
    "limit": 10,
    "organization_id": null,
    "department": null,
    "status": "active"
  },
  "items": [
    {
      "user_id": "67890abcdef...",
      "email": "jane@example.com",
      "name": "Jane Doe",
      "department": "Engineering",
      "organization_id": "org_123",
      "last_active_at": "2025-01-31T18:22:00.000Z"
    }
  ],
  "total": 10,
  "notes": [
    "Sorting on updated_at benefits from an index: { updated_at: -1 }"
  ]
}
```

Table usage:
- Render a table with columns: Name, Email, Department, Org, Last Active.
- Provide a `limit` selector in UI if needed.

## Related Users/Session Endpoints (outside /api/users/analytics)

- GET `/api/users/tenant-summary` — Tenant-wise active user summary with optional `from`, `to`, `status`, and `includeInactive`.
- GET `/api/users/active-trend` — Time-bucketed counts of distinct active users from session tracking with `day|week` granularity.

See `src/routes/users.routes.js` for full parameter details and response shapes.

## Frontend Usage Instructions

The Users Analytics page typically includes a filter bar and a set of charts/KPI cards and tables. Filters are translated to backend queries by the frontend API utility (see `mongodb_dashboard_frontend/src/api/usersAnalytics.js`).

- Filters:
  - Organization selector → `organization_id`
  - Department selector → `department`
  - Date range → `from` and `to` in ISO strings
  - Status selector (optional) → `status`. Many engagement endpoints default to `status=active` when not provided by UI.

- URL Query Persistence:
  - The frontend should persist active filters into the page URL’s query string for shareable links and back/forward navigation. When the component mounts, it should parse existing query parameters and hydrate the filter state.

- Loading/Error States:
  - Show a skeleton or spinner per widget while awaiting API responses.
  - If an endpoint fails, surface a compact error state for that widget without collapsing the entire page; include a retry button.
  - For partial failures (some widgets load, others fail), retain the successfully loaded widgets.

- Data Shaping for Charts:
  - Time series: use `series` arrays with `date` or `label` fields as the x-axis and numeric `value` as y.
  - Breakdown charts: use arrays of `{ label, count }` for bar/pie charts.
  - KPIs: Use numeric fields such as `DAU`, `WAU`, `MAU`, `percentAccepted`, `avgTimeToAcceptDays`, `growthRate` of the response.

- API Client:
  - The file `mongodb_dashboard_frontend/src/api/usersAnalytics.js` normalizes UI filters to backend params. Engagement endpoints pass `status=active` by default if not set by UI.

## Index Recommendations (MongoDB)

To support efficient analytics queries:

- Single-field indexes:
  - `users.created_at` (ascending): `{ created_at: 1 }`
  - `users.updated_at` (ascending, or descending for “top active”): `{ updated_at: 1 }` and/or `{ updated_at: -1 }`
  - `users.organization_id`: `{ organization_id: 1 }`
  - `users.department`: `{ department: 1 }`

- Compound indexes (consider based on cardinality and query patterns):
  - `{ organization_id: 1, updated_at: -1 }`
  - `{ department: 1, updated_at: -1 }`
  - `{ organization_id: 1, created_at: 1 }`

These indexes directly support filters and sorts in:
- Activity metrics (`updated_at`)
- Growth metrics (`created_at`)
- Breakdowns (by `department`, `organization_id`)
- Top active users (sort by `updated_at`)

For session-based endpoints (`/api/users/active-trend`, `/api/users/tenant-summary`), ensure appropriate indexes on the `session_tracking` collection (e.g., `tenant_id`, `status`, `last_updated`, `session_start`, `timestamp`). These are referenced in other route files.

## Environment Variables

Backend:
- MongoDB connection is configured in `src/config/db.js`. Ensure the standard variables are provided (see `ENVIRONMENT_NOTES.md`):
  - `MONGODB_URI`: Connection string
  - `MONGODB_DB`: Database name
- Server:
  - `PORT`, `HOST`, and any CORS variables (`FRONTEND_ORIGIN`, `CORS_ORIGINS`) for cross-origin frontends.
- Authentication/tenancy variables are referenced by other parts of the application; user analytics endpoints themselves do not introduce additional environment variables.

Frontend:
- The frontend commonly uses:
  - `REACT_APP_API_BASE_URL`
  - `REACT_APP_DANGEROUSLY_DISABLE_HOST_CHECK`
  - `REACT_APP_MONGODB_URI`
  - `REACT_APP_AUTH_SECRET_SALT`
- Ensure `getApiBaseUrl()` in the frontend resolves to the backend base URL so that `/api/users/analytics/...` endpoints are reachable.

## Known Limitations

- Activity proxy: Engagement and activity metrics use `updated_at` in the `users` collection as a proxy for activity. If `updated_at` is not reliably maintained for user activity, results may not reflect real usage. Consider wiring `session_tracking` or explicit activity events to enrich the model for more accurate engagement metrics across all analytics.
- Missing endpoints: The frontend API file references several endpoints (`/kpis`, `/dau-trend`, `/active-by-department`, `/active-vs-inactive`) that are not currently implemented in the backend router `users.analytics.routes.v2.js`. Available implemented endpoints are documented above. Update the frontend to use available endpoints or implement these routes in the backend before relying on them in UI.
- Cohorts computation: Retention cohorts compute rates by checking distinct activity within fixed windows (7/30/90 days) from cohort start. Variations in calendar alignment and partial month coverage may require additional adjustments based on product expectations.
- Time zone handling: All server-side bucketing and formatting assume UTC. If your UX requires local time, apply client-side conversions and ensure the implications for day/week boundaries are acceptable.

## Future Enhancements

- Implement explicit `/kpis`, `/dau-trend`, `/active-by-department`, `/active-vs-inactive` endpoints (or alias them) to align with frontend expectations.
- Introduce a dedicated activity events collection and unify engagement metrics on standardized signals instead of relying on `users.updated_at`.
- Add server-side gap filling for time series to simplify charting and avoid client-side interpolation.
- Add pagination and sorting options for `top-active-users` beyond simple `limit`.
- Extend compliance metrics with additional funnel steps when the data model supports them (e.g., verification, onboarding milestones).
- Add caching and ETag/If-None-Match support on read-intensive analytics endpoints.

## Sources

- `src/routes/users.analytics.routes.v2.js`
- `src/routes/index.js`
- `src/routes/users.routes.js`
- `ENVIRONMENT_NOTES.md`
- Frontend client references: `data-management-dashboard-144914-144924/mongodb_dashboard_frontend/src/api/usersAnalytics.js`
