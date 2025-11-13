# API Docs and Health Endpoints

- Swagger UI: /api/docs (also available at /docs and /api-docs)
- OpenAPI JSON: /openapi.json (alias: /api-docs.json)
- Health: 
  - /api/health (includes DB status if connected)
  - /health (quick readiness, same payload)

On startup, the server logs the URLs for health and docs for quick verification.

Tenant scoping
- Supply tenant via header x-organization-id or query ?organization_id= when applicable.
- The global organization middleware normalizes and attaches it to the request context.
