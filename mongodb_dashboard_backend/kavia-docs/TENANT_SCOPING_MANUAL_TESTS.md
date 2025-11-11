# Manual verification: JWT-based tenant scoping

Steps:
1) Signup and Login
- POST /api/auth/signup with { organization_id: "org_demo", email: "a@example.com", password: "p@ss" }
- POST /api/auth/login with same payload. Copy id_token from response.

2) Call /api/users without x-organization-id header
- GET /api/users with header Authorization: Bearer <id_token>
- Expect 200 and data filtered by tenant_id=org_demo (no 400 missing header).

3) Backward compatibility: header still works
- GET /api/users with Authorization: Bearer <id_token> and x-organization-id: org_demo
- Should work the same; JWT takes precedence if header differs.

4) Query param compatibility
- GET /api/users?organization_id=org_demo with Authorization: Bearer <id_token>
- Should work; JWT still wins if it differs.

5) LLM costs hierarchy
- GET /api/llm-costs/hierarchy with Authorization: Bearer <id_token>
- Should return results filtered by tenant_id=org_demo.

6) Error case (no JWT and no tenant)
- GET /api/users without Authorization and without x-organization-id -> 401 from verifyAuth or 400 when appropriate.

Notes:
- JWT payload now includes organization_id, tenant_id, and custom:tenant_id.
- Middleware sets req.organizationId and req.tenantId from JWT automatically.
