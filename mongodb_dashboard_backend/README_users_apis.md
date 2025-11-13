# Users APIs - Tenant Header and Swagger Testing

This backend expects a tenant identifier on tenant-scoped endpoints.

Required header:
- x-organization-id: The organization/tenant to scope requests (case-insensitive)

Aliases accepted (header or query): x-org-id, x-tenant-id, x-tenant, ?organization_id, ?tenant_id

Swagger Try it out:
1) Open /docs (or /api/docs)
2) Click Authorize and paste a Bearer token if available. With a token, tenant is taken from JWT and must match any explicit header/query.
3) For GET /api/users, click Try it out and add header x-organization-id=org_demo, then Execute.

curl examples:
- With Bearer + header:
  curl -s -H "Authorization: Bearer <JWT>" -H "x-organization-id: org_demo" "https://<host>/api/users?limit=10"

- Demo mode (no JWT) using header:
  curl -s -H "x-organization-id: org_demo" "https://<host>/api/users?limit=10"

If you see CORS issues from browsers, ensure response includes Access-Control-Allow-Headers with x-organization-id. This repo's CORS config has been updated accordingly.

