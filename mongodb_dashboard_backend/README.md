# Backend

## Root and docs

- Root `/` returns 200 OK with a minimal JSON:
  {
    "success": true,
    "status": "ok",
    "db": "connected|connecting|disconnected",
    "docs": "/api-docs",
    "health": "/api/health",
    "timestamp": "ISO",
    "message": "Welcome to the Dashboard API. See /api-docs for the full OpenAPI."
  }
- Health endpoints: `/api/health` (also `/health`, `/healthz`, `/ready`, `/live`)
- Swagger UI: http://localhost:3001/api/docs (aliases: http://localhost:3001/api-docs and http://localhost:3001/docs)
- OpenAPI JSON: http://localhost:3001/api/docs.json (aliases: http://localhost:3001/openapi.json and http://localhost:3001/api-docs.json)

## Dev stability flags

- DISABLE_WATCH=1 to avoid file watching in constrained CI/containers.
- NODE_OPTIONS="--max-old-space-size=512" to cap memory and prevent OOM killer.
- DEBUG_LLMCOSTS_EXPLAIN=1 to capture explain() for GET /api/llm-costs (logged to console, summarized via response headers x-llm-explain-find/x-llm-explain-count).

Example:
```
npm run dev
# or with watch
npm run dev:watch
# with diagnostics
DEBUG_LLMCOSTS_EXPLAIN=1 npm run dev
```

/api/health is a lightweight liveness endpoint that avoids heavy work and can be used by probes. (Express) - Dashboard API

- Default port: 3001 (configurable via PORT in .env)
- Host bind: 0.0.0.0 by default (configurable via HOST; if HOST is unset or set to 'localhost', the server will bind to 0.0.0.0 to avoid EADDRNOTAVAIL in preview/container environments)
- Startup logs now include standardized readiness markers:
  - READY: http://HOST:PORT
  - BACKEND_READY: url=http://HOST:PORT
  - Listening on http://HOST:PORT
  Use these to detect readiness in CI/preview runners.
- Docs (Swagger UI): http://localhost:3001/api/docs (aliases: http://localhost:3001/api-docs and http://localhost:3001/docs)
- OpenAPI JSON: http://localhost:3001/api/docs.json (aliases: http://localhost:3001/openapi.json and http://localhost:3001/api-docs.json)

No dev proxy/self-proxy
- This backend is standalone; it does not proxy to itself or to a React dev server. Ensure any frontend proxy is configured to point to this backend URL directly, not vice-versa.
- Do not add http-proxy-middleware inside this server to target http://localhost:3001, as that can cause EADDRNOTAVAIL in certain environments.
- Start commands use: node src/server.js (no watch in CI by default).
- In CI, prefer: npm run start:lean

Quick verification for service-type summary
- Requires organizationId via query (?organizationId=...). Aliases organization_id or tenant_id are accepted.
- Range options: daily|weekly|monthly|custom (default: daily).
  - For custom provide startDate and endDate as ISO strings. The endpoint normalizes to full-day UTC bounds.
- Example:
  curl -s "http://localhost:3001/api/service-type/summary?organizationId=T0015&range=weekly" | jq

Quick verification for llm-costs
- List costs (requires tenant via header when no JWT):
  curl -i -H "x-organization-id: T0015" "http://localhost:3001/api/llm-costs?page=1&limit=10"
- Diagnostics (last captured by the above call):
  curl -i "http://localhost:3001/api/llm-costs/diagnostics/last"
- Expect 200 in < 2s with headers:
  x-effective-tenant, x-llm-filter, x-llm-projection, x-llm-sort, x-llm-page, x-llm-limit, x-llm-timing-*

Quick start (development)
- cd data-management-dashboard-144914-144923/mongodb_dashboard_backend
- cp .env.example .env    # then edit as needed
- npm ci                  # or: npm install
- npm run dev             # lean dev: node src/server.js (no file watching). Safe for CI/containers.
- npm run dev:lean        # explicit lean dev (same behavior as dev)
- npm run start:lean      # production env without watch, lower memory spikes, same as start but explicit lean
- npm run start:ci        # CI-optimized start; avoids watchers and caps heap with near-heap-limit snapshot
- npm run dev:watch       # nodemon hot reload for local changes
- curl http://localhost:3001/health       # fast 200
- curl http://localhost:3001/api/health   # includes db state
- npm run health          # script to hit /api/health on current PORT

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
- If your frontend dev server uses a proxy (http-proxy-middleware) to reach this backend, ensure the proxy target points to the actual backend URL (e.g., http://localhost:3001 or the container hostname) and not to an interface that is not routable from the frontend container. Binding to 0.0.0.0 here avoids EADDRNOTAVAIL, but the proxy target must also be reachable.
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

LLM Costs performance tuning:
- LLM_COSTS_ROUTE_TIMEOUT_MS=12000   # route-level timeout for GET /api/llm-costs
- DEFAULT_PAGE_LIMIT=20              # default limit when page is provided without limit

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
  - Auto-fallback: If the preferred port (default 3001) is in use, the server selects a nearby free port (e.g., 3003) and logs:
    - READY: http://0.0.0.0:<port>
    - BACKEND_READY: url=http://0.0.0.0:<port>
    - [ready] Health endpoint: http://0.0.0.0:<port>/health
- Composite endpoint caching/ETag quick test:
  - GET /api/session-tracking/composite?tenant_id=T0000&page=7&limit=200
    - Expect: 200 with ETag and `Cache-Control: public, max-age=60, must-revalidate`
  - Repeat with header `If-None-Match: <etag>` → Expect: 304 Not Modified
  - Repeat within TTL without If-None-Match → Expect: 200 with `X-Cache: HIT` and the same ETag
- Mongo not connected:
  - /api/health will reflect db: disconnected; verify MONGODB_URI and MONGODB_DB in .env.
