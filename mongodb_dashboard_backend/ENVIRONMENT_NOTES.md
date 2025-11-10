# Backend Startup Notes

- Service binds on HOST=0.0.0.0 PORT=3001 (configurable via env).
- Health endpoints (mounted before auth):
  - GET /ready -> always 200 (process readiness)
  - GET /health -> 200 with DB state (connected|connecting|disconnected)
  - GET /api/health -> same as /health
- Swagger:
  - GET /api-docs (alias: /docs) -> Swagger UI (never blocks startup)
  - GET /openapi.json -> OpenAPI document (dynamic server URL)
- The backend does not serve frontend assets.
- Start commands:
  - npm run start -> node src/server.js
  - npm run dev -> NODE_ENV=development node src/server.js

Verify:
- curl http://127.0.0.1:3001/ready
- curl http://127.0.0.1:3001/health
- open http://127.0.0.1:3001/api-docs
