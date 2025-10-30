# Backend Routing Audit and Fix Summary

This document summarizes the routing consolidation and analytics endpoint verification work.

Canonical base: /api

Mounted exactly once:
- /api/auth
- /api/users
- /api/tenants
- /api/data
- /api/llm-costs
- /api/llm-costs-aggregate
- /api/costs
- /api/session
- /api/session-tracking
- /api/app-deployments
- /api/dashboard/overview
- /api (counts endpoints e.g., /api/dashboard/overview/metrics via modules router)

Users analytics:
- Canonical under /api/users:
  - GET /api/users/active-trend
  - GET /api/users/kpi-summary
  - GET /api/users/by-department
  - GET /api/users/by-organization
  - GET /api/users/compliance
- Alias group (single): /api/analytics/users/* mapped to the same handlers.

Removed duplicates:
- Duplicated mounts in app.js (sessionTracking camelCase alias, appDeployments camelCase alias, repeated users mounts) were removed.
- All public mounts are centralized in src/routes/index.js and are mounted once via `app.use('/api', baseRouter)` in app.js.

CORS and JSON:
- CORS is enabled via src/middleware/security.js with dynamic whitelist:
  - Derives origins from REACT_APP_API_BASE_URL, CORS_ORIGIN, CORS_ORIGINS, FRONTEND_ORIGIN.
  - Defaults allow localhost:3000 and the current preview origin.
  - Credentials can be enabled via CORS_CREDENTIALS=true.
- JSON body parsing enabled with `express.json({ limit: '1mb' })`.

Non-analytics modules verified behavior:
- /api/users supports seeding when empty (GET /api/users/seed-if-empty), and list endpoint seeds demo users if collection is entirely empty, ensuring UI shows data.
- /api/dashboard/overview and /api/dashboard/overview/metrics are served by dashboard routes; counts gracefully return zeros when DB is empty.
- /api/session-tracking returns arrays or envelopes with normalized numeric fields even when using Decimal128.
- /api/app-deployments supports standard list/CRUD and project name resolution with in-memory cache.

Testing notes:
- OpenAPI available at /openapi.json; Swagger UI at /docs.
- Health: GET /api/health returns DB status.

Environment:
- Ensure MONGODB_URI is set.
- If frontend hosted elsewhere, set FRONTEND_ORIGIN or CORS_ORIGINS accordingly.
