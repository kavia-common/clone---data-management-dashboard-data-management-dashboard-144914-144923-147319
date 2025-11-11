# API Docs and Health Endpoints

- Swagger UI: /api/docs (also available at /docs and /api-docs)
- OpenAPI JSON: /openapi.json (alias: /api-docs.json)
- Health: 
  - /api/health (includes DB status if connected)
  - /health (quick readiness, same payload)

On startup, the server logs the URLs for health and docs for quick verification.
