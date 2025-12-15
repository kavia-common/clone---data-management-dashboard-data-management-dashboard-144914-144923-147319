# Root endpoint behavior and CORS

- Root path `/` now returns `200 OK` with a lightweight JSON payload:
  {
    "success": true,
    "status": "ok",
    "db": "connected|connecting|disconnected",
    "docs": "/api-docs",
    "health": "/api/health",
    "timestamp": "ISO string",
    "message": "Welcome to the Dashboard API. See /api-docs for the full OpenAPI."
  }

- Canonical health check is available at `/api/health` (also `/health`, `/healthz`, `/ready`, `/live`).

- Swagger UI is served at `/api-docs` (and `/docs`, `/api/docs`) with dynamic server URL.

## Service Types Summary (Overview)

- Path: `GET /api/services/summary`
- Source: `session_tracking` collection
- Grouping: `service_type`
- Filters:
  - `range`: daily|weekly|monthly|custom
  - `start_date`, `end_date` when `range=custom`
- Tenant scope:
  - JWT tenant when Authorization is provided
  - Otherwise `x-organization-id` header or `organization_id|tenant_id` query
  - Super admin: `T0000` bypass; optional `include_org_buckets=1` to get `{ orgBuckets: [{ tenant_id, total, services: [{ service_type, count }] }] }`

- CORS:
  - `/api/*` routes are served with permissive, non-credentialed CORS via `permissiveCorsMiddleware`:
    - `Access-Control-Allow-Origin: *`
    - Allowed methods: GET,POST,PUT,PATCH,DELETE,OPTIONS
    - Reflects requested headers or uses a safe default.
  - If the frontend requires credentialed CORS, configure a separate middleware with explicit allowed origins and credentials.
