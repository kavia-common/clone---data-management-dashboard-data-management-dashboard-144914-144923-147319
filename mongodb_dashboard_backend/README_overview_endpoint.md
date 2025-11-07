# Backend Preview and API Docs

The Express backend is configured to bind on 0.0.0.0:3001 and exposes Swagger UI and the OpenAPI JSON.

- Swagger UI: http://localhost:3001/api-docs
- OpenAPI JSON: http://localhost:3001/openapi.json

Scripts:
- npm start -> node src/server.js
- npm run dev -> nodemon src/server.js

Environment:
- PORT defaults to 3001 (override with env PORT)
- HOST defaults to 0.0.0.0

Notes:
- /openapi.json serves interfaces/openapi.json statically; Swagger UI uses that spec.
- Health endpoints are available at /health and /api/health.
