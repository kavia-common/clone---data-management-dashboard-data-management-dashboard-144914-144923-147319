# Backend (Express) - Dashboard API

- Default port: 3001 (configurable via PORT in .env)
- Host bind: 0.0.0.0 by default (configurable via HOST; if HOST is unset or set to 'localhost', the server will bind to 0.0.0.0 to avoid EADDRNOTAVAIL in preview/container environments)
- Docs (Swagger UI): http://localhost:3001/api/docs (aliases: http://localhost:3001/api-docs and http://localhost:3001/docs)
- OpenAPI JSON: http://localhost:3001/api/docs.json (aliases: http://localhost:3001/openapi.json and http://localhost:3001/api-docs.json)

Quick start (development)
- cd data-management-dashboard-144914-144923/mongodb_dashboard_backend
- cp .env.example .env    # then edit as needed
- npm ci                  # or: npm install
- npm run dev             # plain Node process (no nodemon) binds to 0.0.0.0:3001; backend-only (no frontend dev server).
- curl http://localhost:3001/health       # fast 200
- curl http://localhost:3001/api/health   # includes db state

Scripts
- dev: plain Node for low memory environments (default dev workflow)
- dev:nodemon: same server but with nodemon hot reload (higher overhead)
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
- Configure the frontend dev proxy to target http://localhost:3001 for API routes (e.g., setupProxy.js or package.json "proxy").
  - Example (CRA setupProxy.js): proxy '/api' to 'http://localhost:3001'
  - Ensure the proxy target is the backend (port 3001), not the frontend (port 3000), to avoid proxy loops or ECONNRESET.
  - In container/preview environments, 'localhost:3001' generally resolves to this backend; if using different hosts or networks, update the proxy target accordingly.
- Do not configure the backend to proxy to itself; there is no backend proxy middleware here by design to avoid loops.

Health, readiness, keepalive
- /health, /healthz, /ready return basic status for uptime checks
- /api/db-ready returns 200 only when MongoDB is connected (useful for gating tests)
- A lightweight keepalive timer runs in the server process by default (KEEPALIVE_INTERVAL_MS, default 30000)

Environment Variables
Create a `.env` file in this directory with values appropriate for your environment (do not commit secrets).

Common variables:
- HOST=0.0.0.0
- PORT=3001
- MONGODB_URI=mongodb+srv://...
- MONGODB_DB=test
- ALLOW_DEMO_AUTH=true (optional; enables tokenless dev with header scoping)
- AUTH_DEFAULT_TENANT=DEMO
- KEEPALIVE_INTERVAL_MS=30000

Note: The app will start even if MONGODB_URI is not set; health/docs endpoints remain available. Mongo connects when properly configured (non-fatal on startup when missing). For endpoints that require DB, the server responds 503 with status=db-not-connected until Mongo is connected. You can check DB readiness via GET /api/db-ready.

Tenant-scoped requests and /api/llm-costs in development
- The `/api/llm-costs` route is protected by verifyAuth and tenant scoping.
- In development without a real JWT, either:
  - Set `ALLOW_DEMO_AUTH=true` and provide a tenant scope header:
    - Example: curl -H "x-organization-id: DEMO" http://localhost:3001/api/llm-costs
  - Or use a valid Bearer token containing a tenant claim (tenantId/tenant_id/organization_id).
- If MONGODB_URI is not configured, `/api/llm-costs` returns 503 (Database not configured).

Troubleshooting (ports and proxies)
- EADDRINUSE: Another process is using port 3001. Stop the other process or change PORT.
- EADDRNOTAVAIL: HOST is not available. Use HOST=0.0.0.0 (default) or remove HOST. Ensure any dev proxy targets http://localhost:3001 and not the backend itself through another proxy path to avoid loops.
- Costs tab backend call (example): GET /api/llm-costs/users?organization_id=T0015&page=1&limit=10
- ECONNRESET during startup can be caused by a misconfigured external proxy hitting the backend before it is ready. Verify frontend dev proxy points to http://localhost:3001 and that only one backend instance is running.
- Ensure only the backend uses port 3001 and the frontend uses 3000 to avoid collisions.

Resource-constrained environments
- Default dev script is plain Node to minimize memory usage and prevent premature exits.
- To enable hot reload with nodemon (uses legacyWatch and a 2s delay to reduce filesystem pressure):
  - npm run dev:nodemon

LLM costs user enrichment
- The GET /api/llm-costs endpoint enriches each users[] entry by joining users[].user_id to users._id (stored as string UUID) and attaches the matched document as users[].user (null when not found)
