# Root endpoint behavior and CORS

- Root path `/` now returns `200 OK` with a lightweight JSON payload:
  {
    "success": true,
    "status": "ok",
    "db": "connected|connecting|disconnected",
    "docs": "/api-docs",
    "health": "/api/health",
    "timestamp": "ISO string",
    "message": "Welcome to the Dashboard API. See /api-docs for the full OpenAPI."
  }

- Canonical health check is available at `/api/health` (also `/health`, `/healthz`, `/ready`, `/live`).

- Swagger UI is served at `/api-docs` (and `/docs`, `/api/docs`) with dynamic server URL.

- CORS:
  - `/api/*` routes are served with permissive, non-credentialed CORS via `permissiveCorsMiddleware`:
    - `Access-Control-Allow-Origin: *`
    - Allowed methods: GET,POST,PUT,PATCH,DELETE,OPTIONS
    - Reflects requested headers or uses a safe default.
  - If the frontend requires credentialed CORS, configure a separate middleware with explicit allowed origins and credentials.
