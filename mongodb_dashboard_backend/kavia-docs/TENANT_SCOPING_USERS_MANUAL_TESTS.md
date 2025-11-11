# Manual verification - /api/users tenant scoping

Preconditions:
- Backend running with ALLOW_DEMO_AUTH=true for demo token path.
- Use Authorization: Bearer ok and x-tenant-id headers to emulate tenants.

Tests:
1) List users:
   - Seed: POST /api/dev/seed-users (if available) or insert via DB with tenant_id both orgA and orgB.
   - GET /api/users with headers x-tenant-id: orgA -> only users with tenant_id=orgA returned.
   - GET /api/users with headers x-tenant-id: orgB -> only users with tenant_id=orgB returned.
   - Provide filter with tenant_id in query and confirm server still enforces req.tenantId (ignores client tenant in filter).

2) Get by id:
   - With x-tenant-id: orgA fetch an orgA user's id -> 200.
   - With x-tenant-id: orgB fetch the same id -> 404 (not found across tenant).

3) Create/Update:
   - POST /api/users with a body having tenant_id:"orgB" while header x-tenant-id: orgA.
     Response document must have tenant_id="orgA" (server-stamped).
   - PUT /api/users/:id ensure updates are allowed only within same tenant.

4) Active trend:
   - GET /api/users/active-trend without tenant_id, headers x-tenant-id: orgA -> response is scoped to orgA.
   - GET with ?tenant_id=orgB but headers orgA -> 403 forbidden.

5) Count:
   - GET /api/users/count with headers orgA -> count only orgA users; change header to orgB -> expect orgB count.

Notes:
- verifyAuth + requireTenant must be mounted before /api/users as in routes/index.js.
- The server ignores any client-sent organization_id/tenant_id in filters and payloads; it enforces req.tenantId internally.
