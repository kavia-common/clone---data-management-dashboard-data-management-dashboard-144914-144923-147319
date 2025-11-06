# MongoDB Dashboard Frontend (React)

Modern, modular React dashboard styled with the "Ocean Professional" theme to manage data via an Express.js API.

## Highlights

- No authentication required: the dashboard loads directly for all users.
- Collections: Users, Session Tracking, App Deployments — CRUD UIs with modals and data tables.
- Charts: KPI area chart for overview/trends.
- Theming: Blue primary and amber accents, subtle gradients, rounded surfaces.
- API Integration: Axios instance with interceptors, environment‑based base URL, standardized helpers.
- Structure: Clean separation of pages, components, routes, and API client.

## Tenant-wise Users Bar Chart

The Users tab integrates a tenant-wise users bar chart above the Users table. It visualizes distinct active users by tenant and supports time range and status filters.

- Component: src/components/users/UsersByTenantBarChart.jsx
- Data helper: src/api/usersAnalytics.js (getTenantUsersSummary)
- Backend endpoint: GET /api/users/tenant-summary

### API usage (getTenantUsersSummary)

getTenantUsersSummary(params?: { from?: string|Date, to?: string|Date, status?: string, includeInactive?: boolean }) returns:
- { items: Array<{ tenant_id: string, tenant_name?: string|null, user_count: number }>, total: number }

Request parameters:
- from: ISO date-time lower bound (optional)
- to: ISO date-time upper bound (optional)
- status: Session status filter, default "completed|active"
- includeInactive: When true, includes tenants without recent activity (default false)

Example:
```js
import { getTenantUsersSummary } from "./src/api/usersAnalytics";

const { items, total } = await getTenantUsersSummary({
  from: "2024-09-01T00:00:00.000Z",
  to: "2024-10-01T00:00:00.000Z",
  status: "completed|active",
  includeInactive: false,
});
```

### Endpoint response shape

- 200 OK
```json
{
  "items": [
    { "tenant_id": "org1", "tenant_name": "Organization One", "user_count": 12 }
  ],
  "total": 1
}
```

Caching behavior:
- The backend caches results in-memory for approximately 5 minutes per instance to reduce repeated aggregation cost. Cache is per-process and non-persistent.

### Users tab integration and UI

- Placement: UsersByTenantBarChart is rendered above the Users table on the Users dashboard screen (src/pages/dashboard/Users.jsx).
- Controls:
  - Date range select: Last 7, 14, 30, 90 days. This adjusts from/to ISO parameters used by the chart’s data call.
  - Tenant filter: The chart provides a high-level overview across tenants. When a user row is opened, the tenant id is derived and may be used for future filtering enhancements.
- Interaction:
  - Bars are clickable; onBarClick is provided for future filtering of the table by tenant (currently logs selection).
- Context with existing histogram:
  - The screen also includes a session duration histogram elsewhere in the dashboard (Sessions area). The same general date-window pattern is followed to provide consistent time-range semantics across visualizations.

### Component usage

```jsx
<UsersByTenantBarChart
  from={fromIso}
  to={toIso}
  status={"completed|active"}
  includeInactive={false}
/>
```

Environment notes:
- The API base is determined by REACT_APP_API_BASE_URL and REACT_APP_API_PREFIX.
- The frontend container recognizes:
  - REACT_APP_API_BASE_URL
  - REACT_APP_DANGEROUSLY_DISABLE_HOST_CHECK (if present in your environment to relax host checks in dev tooling)

## Quickstart

1) Install dependencies
- npm install

2) Configure environment
- Copy .env.example to .env and set:

  - REACT_APP_API_BASE_URL (required in cloud preview):
    https://vscode-internal-14377-beta.beta01.cloud.kavia.ai:3001
  - REACT_APP_API_PREFIX (default /api)
- Optional: You may use REACT_APP_API_URL instead of REACT_APP_API_BASE_URL; if both are set, REACT_APP_API_URL is preferred.

3) Run the app
- npm start

App will run at http://localhost:3000 (or your environment preview URL)

### Verify backend connectivity
- The API base URL is resolved as: ${REACT_APP_API_BASE_URL}${REACT_APP_API_PREFIX}
- In development, the console prints:
  [API] baseURL: <resolved> (RAW: <raw> PREFIX: <prefix>) — Ensure REACT_APP_API_BASE_URL is set to https://vscode-internal-14377-beta.beta01.cloud.kavia.ai:3001
- Ensure it points to EXACTLY:
  https://vscode-internal-14377-beta.beta01.cloud.kavia.ai:3001/api
- Backend OpenAPI (for reference): /openapi.json or the provided environment docs URL.

### Users list from Swagger
- The Users screen calls GET /api/users and supports both:
  - Paginated envelope: { success, data: [...], meta: { page, limit, total } }
  - Non-paginated array: [...]
- The component normalizes both shapes; records are shown in a modern Ocean Professional table.

### Troubleshooting "Network error"
- Common causes:
  1. Wrong API base URL or protocol mismatch (http vs https).
     - Fix .env to use the correct origin. For example:
       REACT_APP_API_BASE_URL=https://vscode-internal-14377-beta.beta01.cloud.kavia.ai:3001
  2. Backend not reachable from the frontend origin (server down, wrong port).
     - Open the backend docs URL directly to confirm availability.
  3. CORS rejection on the backend.
     - Ensure backend enables CORS allowing the frontend origin, e.g.:
       origin: ["http://localhost:3000","https://<your-frontend-host>:3000"]
       methods: ["GET","POST","PUT","DELETE","OPTIONS"], credentials: false
  4. Self-signed or invalid TLS certificate when using https.
     - Use a valid certificate or access via http if acceptable in dev.
  5. Mixed content blocked: https page calling http API.
     - Use https for both frontend and backend in secure environments.

### Endpoint compatibility
- This frontend targets:
  - GET/POST /api/users, PUT/DELETE /api/users/:id
  - GET/POST /api/session-tracking, PUT/DELETE /api/session-tracking/:id
  - GET/POST /api/app-deployments, PUT/DELETE /api/app-deployments/:id
- If your backend differs, adjust src/api/client.js paths accordingly.


## Project Structure

- src/
  - api/client.js — Axios client + API functions (CRUD for all collections)
  - components/
    - layout/ — Topbar, Sidebar, AppLayout
    - ui/ — Button, Modal, Card
    - charts/ — KPIChart (Recharts)
    - DataTable.jsx — generic table with sorting and actions
    - UsersList.jsx — reusable users list component that consumes /api/users
  - pages/
    - dashboard/Overview.jsx, Users.jsx, Sessions.jsx, Deployments.jsx
  - routes/AppRoutes.jsx — public routes
  - App.js — root composition
  - App.css / index.css — Ocean Professional theme styles

## Environment Variables

The frontend supports two variable names for the backend base URL (either is fine):
- REACT_APP_API_URL: Backend API root (takes precedence if set)
- REACT_APP_API_BASE_URL: Backend API root (recommended)

Other variables:
- REACT_APP_API_PREFIX: API prefix used by the backend. Default: /api
- REACT_APP_BACKEND_PORT: Used for auto-detection when REACT_APP_API_BASE_URL is not set. Default: 3001

Setup steps:
- Copy .env.example to .env
- For local dev:
  - REACT_APP_API_BASE_URL=http://localhost:3001
- For cloud preview (example):
  - REACT_APP_API_BASE_URL=https://vscode-internal-19172-beta.beta01.cloud.kavia.ai:3001

Notes:
- Do not commit .env; use .env.example as reference.
- If you encounter “Network Error” from Axios, verify:
  1) The backend is reachable at the URL you configured (open it in the browser)
  2) The port matches your backend server port (default 3001)
  3) CORS is allowed by the backend (or access via same-origin proxy)
  4) The API prefix matches your backend (default /api)

## Proxy and HTTPS

In secure preview environments (https), browsers will block http requests to a backend (mixed content). To prevent this, the app includes a development proxy:

- src/setupProxy.js forwards:
  - /api -> backend (http://localhost:3001 by default)
  - /openapi.json -> backend
- If REACT_APP_API_BASE_URL is NOT set, the API client uses a relative base (/api), which the dev server proxies to the backend.
- If you set REACT_APP_API_BASE_URL in an https environment, make sure the backend is also available over https at that URL. Otherwise leave it unset to use the proxy.

Verification:
- Start backend on port 3001
- Start frontend (npm start)
- Visit the app, open DevTools -> Network
- Confirm requests go to /api/... and succeed
- Check /openapi.json request (health check) succeeds (200)

## API Endpoints

The frontend expects conventional REST endpoints:
- Users: GET/POST /users, PUT/DELETE /users/:id
- Sessions: GET/POST /session-tracking, PUT/DELETE /session-tracking/:id
- Deployments: GET/POST /app-deployments, PUT/DELETE /app-deployments/:id

Adjust src/api/client.js if your backend differs.

## Accessibility and Security

- Keyboard-accessible modals and buttons
- If your backend requires authentication, wire it in your API gateway/reverse proxy as needed; the UI does not enforce auth.

## Customization

- Update colors and radii in App.css variables.
- Extend DataTable columns and forms based on your schema.
- Add pagination and server-side filters as your API supports them.

## Testing

- CRA testing setup is included; extend tests in src/.
