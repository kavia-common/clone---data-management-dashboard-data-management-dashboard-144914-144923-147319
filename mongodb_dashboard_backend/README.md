# Backend (Express) - Dashboard API

- Default port: 3001 (configurable via PORT)
- Host bind: 0.0.0.0 by default (configurable via HOST; if HOST is unset or set to 'localhost', the server will bind to 0.0.0.0 to avoid EADDRNOTAVAIL in preview/container environments)
- Docs (Swagger UI): http://localhost:3001/api/docs (aliases: http://localhost:3001/api-docs and http://localhost:3001/docs)
- OpenAPI JSON: http://localhost:3001/api/docs.json (aliases: http://localhost:3001/openapi.json and http://localhost:3001/api-docs.json)

Quick start (development)
- cd data-management-dashboard-144914-144923/mongodb_dashboard_backend
- cp .env.example .env    # then edit as needed
- npm ci                  # or: npm install
- npm run dev             # binds to 0.0.0.0:3001; dotenv is loaded programmatically; backend only (no React/webpack dev server)
- npm run dev:watch       # same as dev, but with nodemon hot reload for local changes
- curl http://localhost:3001/healthz      # fast 200 liveness
- curl http://localhost:3001/health       # fast 200 liveness
- curl http://localhost:3001/api/health   # includes db state

Scripts
- start: production-style boot; uses node src/server.js on 0.0.0.0:3001 with memory-safe NODE_OPTIONS
- dev: runs the server with PORT/HOST defaults applied in-process (CI-compatible)
- dev:watch: nodemon watcher if available (hot reload)
- preview: same as start
- test: jest runs in-band
- lint: non-fatal warnings; use lint:strict locally to enforce --max-warnings=0

Important
- This backend is not a CRA/React app. Do not add or run `react-scripts` or webpack dev server here.
- Browserslist/webpack configuration should live in the frontend container only.

Preview runner compatibility
- The server binds to 0.0.0.0:PORT and logs readiness pointers: /health | /healthz | /readiness | /api/health | /api/docs | /api-docs
- Readiness log markers (either is sufficient for detectors):
  - READY: http://HOST:PORT
  - BACKEND_READY: url=http://HOST:PORT
  - Listening on http://HOST:PORT

OOM protection and memory usage
- All scripts run with NODE_OPTIONS=--max-old-space-size=256 to reduce memory footprint and avoid OOM during build/test in CI.
- Jest runs in-band.

Environment Variables
Create a `.env` file in this directory with values appropriate for your environment (do not commit secrets).

Common variables:
- HOST=0.0.0.0
- PORT=3001
- MONGODB_URI=mongodb+srv://...
- MONGODB_DB=test
- BACKEND_PROTOCOL=http
- BACKEND_HOST=localhost
- BACKEND_PORT=3001
- BACKEND_BASE_URL=http://localhost:3001

CORS
- Defaults allow localhost:3000 and the current host:3001 (Swagger UI served by backend).
- You can set FRONTEND_ORIGIN or CORS_ORIGINS to customize.
- To allow credentials, set CORS_CREDENTIALS=true (enable only if needed).
- Emergency development: set CORS_OPEN=true to allow all origins (not for production).
- Allowed headers include x-organization-id and x-tenant-id used by tenant-scoped endpoints.

Swagger/OpenAPI servers
- The OpenAPI spec is served dynamically and uses same-origin so Swagger UI calls this backend instance.
- Endpoints:
  - UI: /api/docs (aliases: /api-docs, /docs)
  - Spec JSON: /api/docs.json (aliases: /openapi.json, /api-docs.json)

Tenant-scoped requests
- When Authorization (Bearer JWT) is not provided, send x-organization-id header on tenant-scoped endpoints (e.g., /api/llm-costs).
- Example:
  - curl -H "x-organization-id: org_demo" http://localhost:3001/api/llm-costs

Health/readiness
- GET /healthz → Fast liveness with { status: "ok", db: connected|connecting|disconnected, timestamp }
- GET /health → Fast liveness with same payload
- GET /api/health → Same payload; safe for monitoring
- GET /readiness → DB readiness probe using quick ping
- Health responses include no-store Cache-Control headers.

Troubleshooting
- Port already in use (EADDRINUSE):
  - Another instance might be running. A PID file is managed under .tmp/server.<port>.pid.
- Mongo not connected:
  - /api/health will reflect db: disconnected; verify MONGODB_URI and MONGODB_DB in .env.
