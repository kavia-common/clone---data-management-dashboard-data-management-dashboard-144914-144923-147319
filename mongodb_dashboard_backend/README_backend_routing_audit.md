# Backend Routing Audit and Canonicalization

This backend has been audited to ensure all modules respond under a single canonical base: `/api`.

Key points:
- Canonical mounts happen in `src/app.js` via `app.use('/', require('./routes'))`.
- `src/routes/index.js` mounts all module routers relative to `/api`:
  - Users CRUD and analytics: `/api/users/*`
  - Analytics users alias: `/api/analytics/users/*` (single alias group)
  - Session: `/api/session/*`
  - Session tracking: `/api/session-tracking/*` and `/api/sessionTracking/*` (alias for compatibility)
  - App deployments: `/api/app-deployments/*` and `/api/appDeployments/*` (alias)
  - LLM costs: `/api/llm-costs/*` and `/api/llmCosts/*` (alias)
  - Tenants: `/api/tenants/*`
  - Projects: `/api/projects/*`
  - Dashboard overview: `/api/dashboard/overview/*`
  - Sample data: `/api/data/*`
  - Costs by agent: `/api/costs/*`

Removed/avoided duplicates:
- No direct mounting of legacy `/api/users/analytics` to prevent shadowing.
- `/api/analytics/users/*` is the only analytics alias group; do not add additional aliases.

Users analytics endpoints (backed by users collection fields only unless stated):
- GET `/api/users/active-trend` -> time-bucketed distinct active users based on session_tracking; schema: `{ items: [{ date, total }], meta }`.
- GET `/api/users/kpi-summary` -> KPIs: total, active, admin, dau/wau/mau (from timestamps).
- GET `/api/users/by-department` -> `{ items: [{ department, count }] }`.
- GET `/api/users/by-organization` -> `{ items: [{ organization_id, count }] }`.
- GET `/api/users/compliance` -> `{ items: [{ name, count }] }`.
- GET `/api/users/tenant-summary` -> controller returns `{ success, items, total }`; route maps to array `[{ tenant, count }]` for legacy frontend compatibility.

CORS and base URL:
- CORS is configured in `src/middleware/security.js`. Whitelist derives from:
  - `FRONTEND_ORIGIN`, `CORS_ORIGIN`, `CORS_ORIGINS`
  - `REACT_APP_API_BASE_URL` (origin inferred)
  - Localhost defaults and the cloud preview origin
- Credentials allowed when `CORS_CREDENTIALS=true`.
- See `.env.example` for sample configuration.

Status endpoints and docs:
- Health: `GET /api/health`
- OpenAPI: `GET /openapi.json`, `GET /api-docs.json`
- Swagger UI: `/docs`, `/api-docs`

Notes:
- All changes are backend-only and additive for compatibility. The frontend should not need changes.
- If any module responds empty, verify MongoDB connectivity and that the environment variables are set.
