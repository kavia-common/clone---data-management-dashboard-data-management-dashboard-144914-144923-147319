# Backend (Express) - Dashboard API

- Default port: 3001 (configurable via PORT in .env)
- Host bind: 0.0.0.0 by default (configurable via HOST)
- Docs (Swagger UI): http://localhost:3001/api/docs (aliases: http://localhost:3001/api-docs and http://localhost:3001/docs)
- OpenAPI JSON: http://localhost:3001/api/docs.json (aliases: http://localhost:3001/openapi.json and http://localhost:3001/api-docs.json)

Quick start (development)
- cd data-management-dashboard-144914-144923/mongodb_dashboard_backend
- npm ci        # or: npm install
- npm run dev   # binds to 0.0.0.0:3001; dotenv is loaded programmatically; backend only (no React/webpack dev server)
- curl http://localhost:3001/health       # fast 200
- curl http://localhost:3001/api/health   # includes db state
- curl "http://localhost:3001/api/users?organization_id=T0000" -H "Authorization: Bearer <token>" # tenant-scoped users (T0000 special case for super admin)

Dev server binding and proxy notes
- Host binding is forced to 0.0.0.0 by default. If HOST is set to an unavailable address, the server falls back to 0.0.0.0 automatically to avoid EADDRNOTAVAIL.
- There is no internal HTTP proxy configured in this backend. Frontend should call backend using:
  - Relative paths when served via same origin, or
  - REACT_APP_API_BASE_URL environment variable for absolute target on the frontend side.
- To customize binding:
  - HOST=127.0.0.1 npm run dev   # local only
  - PORT=3100 npm run dev        # different port

Troubleshooting EADDRNOTAVAIL / EADDRINUSE
- EADDRNOTAVAIL: Caused by binding to a non-existent IP. The server now retries on 0.0.0.0 automatically and still logs READY markers.
- EADDRINUSE: Another instance is running. A PID file is used: .tmp/server.<port>.pid. Stop the existing process or use a different PORT.

Memory usage
- Node memory is capped via NODE_OPTIONS=--max_old_space_size=384 in dev/start to avoid OOM kills in preview environments.

Scripts
- dev: runs the server with PORT/HOST defaults applied in-process (CI-compatible)
- dev:watch: nodemon watcher if available (hot reload)
- start: production-style boot; same host/port defaults
- preview: same as start
- test: jest

Preview runner compatibility
- The server binds to 0.0.0.0:PORT and logs readiness pointers: /health | /ready | /api/health | /api/docs | /api-docs
- Readiness log markers (either is sufficient for detectors):
  - BACKEND_READY: url=http://HOST:PORT
  - Listening on http://HOST:PORT
  - Server ready: http://HOST:PORT (env=...)
- Health endpoints for readiness checks:
  - GET /health       -> always 200 with db state
  - GET /ready        -> alias to /health (for Kubernetes-style readiness probes)
  - GET /api/health   -> 200 with db state (same as /health)
  - GET /healthz      -> alias to /health

Important
- Always run preview/start commands from this backend directory:
  - cd data-management-dashboard-144914-144923/mongodb_dashboard_backend
  - npm run dev  (or npm start)
- dotenv is loaded inside src/server.js; no need to use -r dotenv/config flags.

Environment Variables
Create a `.env` file in this directory with values appropriate for your environment (do not commit secrets).

Common variables:
- HOST=0.0.0.0
- PORT=3001
- MONGODB_URI=mongodb+srv://...
- MONGODB_DB=test

Note: The app will start even if MONGODB_URI is not set; health/docs endpoints remain available. Mongo connects when properly configured (non-fatal on startup when missing).

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
- Additional helper:
  - GET /api/docs/headers — explains tenant header usage for Try It Out.

Proxy/Frontend integration
- Frontend should prefer:
  - Same-origin relative calls when both are served together, or
  - Configurable absolute base via REACT_APP_API_BASE_URL on the frontend container.
- Avoid hardcoding IPs in proxy configs; use environment variables to point to this backend:
  - Example: REACT_APP_API_BASE_URL=http://localhost:3001

Tenant-scoped requests
- When Authorization (Bearer JWT) is not provided, send x-organization-id header on tenant-scoped endpoints (e.g., /api/llm-costs).
- Example:
  - curl -H "x-organization-id: org_demo" http://localhost:3001/api/llm-costs

Health/readiness
- GET /health → Fast readiness with { status: "ok", db: connected|connecting|disconnected, timestamp }
- GET /api/health → Same payload; safe for monitoring
- Health responses include no-store Cache-Control headers.

Notes on authentication and hashing
- Uses per-organization orgSalt (v2) with optional environment pepper. Legacy v1 hashes are migrated on login.
- Public auth endpoints:
  - POST /api/auth/signup
  - POST /api/auth/login
  - POST /api/auth/reset-password

Troubleshooting
- Port already in use (EADDRINUSE):
  - Another instance might be running. A PID file is managed under .tmp/server.<port>.pid.
- Mongo not connected:
  - /api/health will reflect db: disconnected; verify MONGODB_URI and MONGODB_DB in .env.
