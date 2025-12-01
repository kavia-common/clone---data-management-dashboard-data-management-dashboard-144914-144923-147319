# Backend (Express) - Dashboard API

- Default port: 3001 (configurable via PORT in .env)
- Host bind: 0.0.0.0 by default (configurable via HOST; if HOST is unset or set to 'localhost', the server will bind to 0.0.0.0 to avoid EADDRNOTAVAIL in preview/container environments)
- Docs (Swagger UI): http://localhost:3001/api/docs (aliases: http://localhost:3001/api-docs and http://localhost:3001/docs)
- OpenAPI JSON: http://localhost:3001/api/docs.json (aliases: http://localhost:3001/openapi.json and http://localhost:3001/api-docs.json)

Quick start (development)
- cd data-management-dashboard-144914-144923/mongodb_dashboard_backend
- cp .env.example .env    # then edit as needed
- npm ci                  # or: npm install
- npm run dev             # binds to 0.0.0.0:3001; dotenv is loaded programmatically; backend only (Express-only, no React/webpack dev server). Uses nodemon hot reload. NODE_OPTIONS uses --max-old-space-size=256.
- npm run dev:watch       # same as dev, but with nodemon hot reload for local changes
- curl http://localhost:3001/health       # fast 200
- curl http://localhost:3001/api/health   # includes db state

Scripts
- dev: runs the server with PORT/HOST defaults applied in-process (CI-compatible)
- dev:watch: nodemon watcher if available (hot reload)
- start: production-style boot; same host/port defaults
- preview: same as start
- test: jest

Preview runner compatibility
- The server binds to 0.0.0.0:PORT and logs readiness pointers: /health | /ready | /api/health | /api/docs | /api-docs
- Readiness log markers (either is sufficient for detectors):
  - READY: http://HOST:PORT
  - BACKEND_READY: url=http://HOST:PORT
  - Listening on http://HOST:PORT
  - Server ready: http://HOST:PORT (env=...)
- If your frontend dev server uses a proxy (http-proxy-middleware) to reach this backend, ensure the proxy target points to the actual backend URL (e.g., http://localhost:3001) and not to the backend itself or a non-routable interface. Binding to 0.0.0.0 here avoids EADDRNOTAVAIL, but the proxy target must also be reachable.
- Health endpoints for readiness checks:
  - GET /health       -> always 200 with db state
  - GET /ready        -> alias to /health (for Kubernetes-style readiness probes)
  - GET /api/health   -> 200 with db state (same as /health)
  - GET /healthz      -> alias to /health

Frontend dev proxy configuration (important)
- Frontend typically runs on http://localhost:3000
- Configure the frontend dev proxy to target http://localhost:3001 for API routes (e.g., setupProxy.js or package.json "proxy")
- Do not configure the backend to proxy to itself; there is no backend proxy middleware here by design to avoid loops

Health and readiness
- /health, /healthz, /ready return basic status for uptime checks
- /api/db-ready returns 200 only when MongoDB is connected (useful for gating tests)

Environment Variables
Create a `.env` file in this directory with values appropriate for your environment (do not commit secrets).

Common variables:
- HOST=0.0.0.0
- PORT=3001
- MONGODB_URI=mongodb+srv://...
- MONGODB_DB=test

Note: The app will start even if MONGODB_URI is not set; health/docs endpoints remain available. Mongo connects when properly configured (non-fatal on startup when missing). For endpoints that require DB, the server responds 503 with status=db-not-connected until Mongo is connected. You can check DB readiness via GET /api/db-ready.

CORS
- Defaults allow localhost:3000 and the current host:3001 (Swagger UI served by backend)
- You can set FRONTEND_ORIGIN or CORS_ORIGINS to customize
- To allow credentials, set CORS_CREDENTIALS=true (enable only if needed)
- Emergency development: set CORS_OPEN=true to allow all origins (not for production)
- Allowed headers include x-organization-id and x-tenant-id used by tenant-scoped endpoints

Swagger/OpenAPI servers
- The OpenAPI spec is served dynamically and uses same-origin so Swagger UI calls this backend instance
- Endpoints:
  - UI: /api/docs (aliases: /api-docs, /docs)
  - Spec JSON: /api/docs.json (aliases: /openapi.json, /api-docs.json)

Tenant-scoped requests
- When Authorization (Bearer JWT) is not provided, send x-organization-id header on tenant-scoped endpoints (e.g., /api/llm-costs)
- Example:
  - curl -H "x-organization-id: org_demo" http://localhost:3001/api/llm-costs

Troubleshooting (ports and proxies)
- EADDRINUSE: Another process is using port 3001. Stop the other process or change PORT.
- EADDRNOTAVAIL: HOST is not available. Use HOST=0.0.0.0 (default) or remove HOST.
- ECONNRESET during startup can be caused by a misconfigured external proxy hitting the backend before it is ready. Verify frontend dev proxy points to http://localhost:3001 and that only one backend instance is running.
- Ensure only the backend uses port 3001 and the frontend uses 3000 to avoid collisions.

Resource-constrained environments
- To reduce memory usage, scripts set NODE_OPTIONS=--max_old_space_size=256 by default
- You can lower further or change the port:
  - PORT=3011 npm run dev
  - NODE_OPTIONS=--max_old_space_size=192 npm run dev
- Nodemon uses legacyWatch and a 2s delay to reduce filesystem pressure. To disable watch hot-reload:
  - npm run dev:express

LLM costs user enrichment
- The GET /api/llm-costs endpoint enriches each users[] entry by joining users[].user_id to users._id (stored as string UUID) and attaches the matched document as users[].user (null when not found)
