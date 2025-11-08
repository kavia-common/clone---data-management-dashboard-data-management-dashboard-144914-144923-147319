# Preview and Scripts Notes

- Always run backend preview commands from this directory:
  data-management-dashboard-144914-144923/mongodb_dashboard_backend

- Scripts:
  - npm run dev
    - In local/dev: uses nodemon with auto-reload.
    - In CI (CI=true): falls back to node (no nodemon) and still binds to HOST and PORT.
  - npm run dev:ci
    - Explicit CI-safe start without nodemon; kills stale processes on the specified port.
  - npm run start:ci
    - Production-mode start, also CI-safe.

- Environment:
  - HOST defaults to 0.0.0.0
  - PORT defaults to 3001

- Health:
  - Readiness endpoint: /health (no DB required)
  - Extended health: /api/health (includes DB status)

Ensure the preview runner working directory points to mongodb_dashboard_backend, not the frontend.

---

## Tenant-based Access Control (ACL)

- Middleware stack on protected routes: verifyAuth -> requireTenant -> tenantScopeEnforcer
  - verifyAuth: parses JWT and normalizes tenantId from tenant_id/tenantId claims.
  - requireTenant: enforces presence of tenantId from JWT; blocks cross-tenant override via headers. In non-production with ALLOW_DEMO_AUTH=true and without JWT, allows x-tenant-id fallback for demos.
  - tenantScopeEnforcer: attaches req.tenantId and helpers to enforce { tenant_id: req.tenantId } on queries/aggregations and to stamp created docs.
- Do not rely on client-provided tenant_id for writes; server overwrites with req.tenantId.
- If a JWT has tenant_id and a different x-tenant-id header is sent, the header is ignored.

## “signal is aborted without reason” (Frontend Troubleshooting)

Common causes:
- Reusing a single AbortController across multiple requests and aborting early.
- Aborting on unmount or route change while a request is still needed.
- Proxy/CORS preflight failing and client treating it like an abort.
- Programmatic navigation immediately after triggering a request without awaiting it.

Checklist:
1. Ensure Authorization and x-tenant-id headers are set (x-tenant-id must match JWT tenant for protected calls).
2. Create a new AbortController per request; only abort the controller created for that specific request in the same effect cleanup.
3. Prefer axios default cancellation or do not pass signal unless required.
4. Handle 401/403/409 by catching and processing; do not abort to “handle” errors.
5. Watch backend dev logs:
   - `[api] METHOD /api/... Authorization=yes x-tenant-id=...`
   - `[tenantScopeEnforcer] METHOD /api/... tenantId=...`

Manual verification:
- GET /api/health -> 200 with DB status.
- Login to obtain a JWT with tenant_id.
- GET /api/users with Authorization; expect tenant-filtered results.
- Attempt cross-tenant access by setting a different x-tenant-id while JWT tenant is fixed -> expect enforcement (header ignored) or 403 where applicable.
- Validate session tracking, costs, analytics routes return only the tenant’s data.

Environment flags:
- ALLOW_DEMO_AUTH=true enables demo behavior for local dev without JWT; not for production.
