# API Docs and Health Endpoints

- Swagger UI: /api/docs (also available at /docs and /api-docs)
- OpenAPI JSON: /openapi.json (alias: /api-docs.json)
- Health: 
  - /api/health (includes DB status if connected)
  - /health (quick readiness, same payload)

On startup, the server logs the URLs for health and docs for quick verification.

Swagger UI usage (Auth and Tenant):
- Click Authorize to enter your Bearer token (JWT).
- For tenant-scoped routes, provide either the x-organization-id header (recommended) or the tenant_id query (or legacy organization_id).
- Try it out will forward these values to the backend. The header takes precedence over query; with a valid JWT, the tenant from the token overrides both.
