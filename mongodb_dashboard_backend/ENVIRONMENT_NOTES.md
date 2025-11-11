# Development Port Handling and Health/Docs

This backend binds to a fixed default port 3001 (configurable via PORT). In development, when the port is already in use, the server will:

- Detect and clean up a stale PID file if found at ./.tmp/server.<PORT>.pid
- Retry binding a few times before failing
- Never auto-switch the port to avoid drift with the frontend proxy or documentation

Environment variables to tune behavior:
- PORT: Port to bind on (default 3001)
- HOST: Host to bind on (default 0.0.0.0)
- NODE_ENV: When set to development, enables the retry/wait logic on EADDRINUSE
- DEV_PORT_RETRY_MS: Milliseconds to wait between retries (default 1500)
- DEV_PORT_MAX_RETRIES: Max retry attempts before failing (default 10)

Useful endpoints:
- Health: GET /api/health and GET /health
- Swagger UI: GET /api/docs
- OpenAPI JSON: GET /openapi.json

Notes:
- In production, behavior is strict: if the port is in use, the process logs an error and exits immediately.
- If you manually kill the process, the ./.tmp/server.<PORT>.pid file is cleaned up on next start if the PID is not alive.
