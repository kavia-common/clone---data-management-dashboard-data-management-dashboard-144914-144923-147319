# Session Tracking API quick verification

Endpoints:
- List: GET /api/session-tracking
- Create: POST /api/session-tracking
- Get by id: GET /api/session-tracking/{id}
- Update: PUT /api/session-tracking/{id}
- Delete: DELETE /api/session-tracking/{id}

Notes:
- Tenant scoping middleware may require Authorization or x-organization-id depending on environment.
- Health: GET /health (aliases: /healthz, /ready, /api/health)
- Swagger UI: /api-docs (aliases: /docs, /api/docs)
- OpenAPI JSON: /openapi.json

Verification checklist:
1) npm run dev (or npm start) — look for "READY: http://HOST:PORT".
2) curl http://127.0.0.1:${PORT:-3001}/health
3) curl http://127.0.0.1:${PORT:-3001}/api/session-tracking
