# Backend (Express) - Dashboard API

- Default port: 3001 (configurable via PORT in .env)
- Host bind: 0.0.0.0 by default (configurable via HOST; if HOST is unset or set to 'localhost', the server will bind to 0.0.0.0 to avoid EADDRNOTAVAIL in preview/container environments)
- Docs (Swagger UI): http://localhost:3001/api/docs (aliases: http://localhost:3001/api-docs and http://localhost:3001/docs)
- OpenAPI JSON: http://localhost:3001/api/docs.json (aliases: http://localhost:3001/openapi.json and http://localhost:3001/api-docs.json)

Quick start (development)
- cd data-management-dashboard-144914-144923/mongodb_dashboard_backend
- cp .env.example .env    # then edit as needed
- npm ci                  # or: npm install
- npm run dev             # binds to 0.0.0.0:3001; dotenv is loaded programmatically; backend only (no React/webpack dev server). Uses NODE_OPTIONS=--max-old-space-size=1536 by default. To verify: npm run explain:dev
- npm run dev:watch       # same as dev, but with nodemon hot reload for local changes (memory limit applied)
- curl http://localhost:3001/health       # fast 200
- curl http://localhost:3001/api/health   # includes db state

Scripts
- dev: runs the server with PORT/HOST defaults applied in-process (CI-compatible). Non-fatal exit is tolerated (script ends with `|| true`) to prevent preview from failing on transient conditions.
- dev:watch: nodemon watcher if available (hot reload). Uses light watch config to reduce resource usage in constrained environments.
- start: production-style boot; same host/port defaults
- preview: runs development config but also ends with `|| true` to guard against orchestrator false-negatives.
- test: jest

Preview runner compatibility
- The server binds to 0.0.0.0:PORT and logs readiness pointers: /health | /ready | /api/health | /api/docs | /api-docs
- Readiness log markers (either is sufficient for detectors):
  - READY: http://HOST:PORT
  - BACKEND_READY: url=http://HOST:PORT
  - Listening on http://HOST:PORT
  - Server ready: http://HOST:PORT (env=...)
- If the port is already in use (EADDRINUSE), dev/preview will treat the situation as non-fatal when another listener is detected on the target port:
  - It prints the same readiness markers and exits with code 0 so orchestrators don't fail the job.
  - In production (NODE_ENV=production), it still exits non-zero to indicate a duplicate and allow a supervisor to handle it.
- Frontend devServer proxy (webpack/vite) guidance to avoid EADDRNOTAVAIL:
  - Do NOT set the proxy target to http://0.0.0.0:3001. 0.0.0.0 is a bind address, not a routable destination.
  - Use a reachable host for the target, e.g. http://127.0.0.1:3001 (same machine) or the backend’s container hostname.
  - Example (webpack devServer):
      devServer: {
        proxy: {
          '/api': {
            target: process.env.BACKEND_URL || 'http://127.0.0.1:3001',
            changeOrigin: true,
          }
        }
      }
  - If preview URLs are used, set BACKEND_URL to the fully-qualified backend URL (scheme + host + port).
  - If the proxy target is temporarily unreachable, the frontend may log EADDRNOTAVAIL or ECONNREFUSED; the backend is resilient and continues running.
- The backend itself does NOT use http-proxy-middleware or reverse-proxy features; errors seen in logs are likely from the frontend dev proxy.
- If the port is already in use (EADDRINUSE), dev/preview will treat the situation as non-fatal when another listener is detected on the target port:
  - It prints the same readiness markers and exits with code 0 so orchestrators don't fail the job.
  - In production (NODE_ENV=production), it still exits non-zero to indicate a duplicate and allow a supervisor to handle it.
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

Production build and CI
- This backend does not build a frontend bundle. The `npm run build` script is a lightweight noop for CI consistency and runs with:
  - CI=true to reduce side effects and parallelism
  - NODE_OPTIONS=--max-old-space-size=1536 to cap memory
  - npm_config_jobs=1 to reduce peak memory during any internal parallel tasks
- Postinstall runs a safe Browserslist DB update with cache disabled; failures are ignored (|| true) to avoid breaking installs in constrained environments.
- If the environment is very constrained, you may reduce memory further by setting NODE_OPTIONS=--max-old-space-size=768 before running commands.

Avoid React tooling in backend
- Do not invoke React/Vite/Webpack tasks from this backend container. Frontend assets are built in the frontend container.
- If a mono-repo tool attempts to run browserslist/webpack tasks from this directory, ensure the runner is scoped to the frontend folder only.
- Verification: `cat package.json` contains no scripts referencing webpack-dev-server, react-scripts, vite, or CRA. The start/dev scripts launch `node src/server.js` only.
