# Users Analytics UI Guide

## Overview

This guide explains how the Users Analytics page should interact with the backend analytics endpoints, how to pass filters, and how to handle loading and error states. It is aligned with the current API client in `src/api/usersAnalytics.js`.

## Filters and Query Param Mapping

- UI filter model:
  - `organization` → backend `organization_id`
  - `department` → backend `department`
  - `status` → backend `status`
  - `from`, `to` → ISO strings for date range

- Engagement defaults:
  - For engagement-oriented widgets (activity trends, breakdowns, top-active), default to `status=active` when status is not explicitly selected by the user. The API client already applies this via `toBackendParams(..., { defaultActive: true })`.

- Date handling:
  - Use UTC on the wire. The backend formats time series labels as `YYYY-MM-DD`. Localize in the UI if desired, taking care with boundaries.

## URL Query Persistence

- Read existing query parameters from the URL on page mount and hydrate the filter state (organization, department, status, from, to).
- When filters change, update the URL using `history.replaceState` or the router’s API so that the page is shareable and back/forward navigation preserves filters.
- Example:
  - `?organization_id=org_123&department=Engineering&from=2025-01-01T00:00:00.000Z&to=2025-02-01T00:00:00.000Z&status=active`

## Data Fetching and Error Handling

- Each widget (chart/KPI/table) should:
  - Show a skeleton or spinner while fetching.
  - On error, render a compact error panel with the HTTP status code and a retry action. Do not block other widgets from rendering.
  - Cancel in-flight requests when filters change rapidly to avoid race conditions.

- API client:
  - The file `src/api/usersAnalytics.js` contains functions like:
    - `fetchUsersKpis`, `fetchDauTrend`, `fetchActiveByDepartment`, `fetchActiveVsInactive`, `fetchTopActiveUsers`
    - `getTenantUsersSummary` (outside `/users/analytics`)
  - Note: Some of these endpoints (e.g., `/kpis`, `/dau-trend`, `/active-by-department`, `/active-vs-inactive`) are not yet implemented on the backend; prefer the implemented endpoints for now or gate UI features based on availability.

## Suggested Widget Bindings

- Activity Trends (line chart):
  - Backend: `/api/users/analytics/activity-trends` (series + DAU/WAU/MAU)
  - Chart: x = `date`, y = `value`
  - KPIs: `kpis.DAU`, `kpis.WAU`, `kpis.MAU`

- Growth (line/bar):
  - Backend: `/api/users/analytics/growth` (series of new users; `growthRate` KPI)

- Activity Breakdown (bars):
  - Backend: `/api/users/analytics/activity-breakdown` (`byDepartment`, `byOrganization`)

- Inactivity (donut + bars/table):
  - Backend: `/api/users/analytics/inactivity` (active vs inactive totals, thresholds)

- Compliance (KPIs + weekly line):
  - Backend: `/api/users/analytics/compliance` (`percentAccepted`, `avgTimeToAcceptDays`, `series`)

- Top Active Users (table):
  - Backend: `/api/users/analytics/top-active-users` (`items` array; supports `limit`)

## Loading and Empty States

- For empty datasets, show a friendly empty state with guidance (e.g., “No activity found in this period. Try widening the date range or removing filters.”).
- For partial data errors, keep the overall layout visible to avoid layout shifts, and encourage retry.

## Notes on Environment Variables

- Ensure `REACT_APP_API_BASE_URL` points to the backend server (e.g., `http://localhost:3001` in development).
- Other applicable variables:
  - `REACT_APP_DANGEROUSLY_DISABLE_HOST_CHECK`
  - `REACT_APP_MONGODB_URI`
  - `REACT_APP_AUTH_SECRET_SALT`
- The `getApiBaseUrl()` helper is responsible for resolving the base URL for API calls.

## Future Improvements

- Add feature flags to hide widgets whose endpoints are not yet available.
- Provide a shared filter context to coordinate the same filters across multiple widgets.
- Add persisted user preferences for default date ranges and status filters.
