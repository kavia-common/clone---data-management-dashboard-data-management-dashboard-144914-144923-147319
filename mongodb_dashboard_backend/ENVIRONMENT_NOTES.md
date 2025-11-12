# Development Port Handling and Health/Docs

This backend binds to a fixed default port 3001 (configurable via PORT). It listens on HOST=0.0.0.0 by default so it’s reachable in preview/container environments.

On port-in-use (EADDRINUSE):
- Check ./.tmp/server.<PORT>.pid (PID guard is written on successful start).
- Identify process listening on the port: `lsof -i :3001 -sTCP:LISTEN -Pn` (or `ss -ltnp | grep :3001`).
- Stop/kill the conflicting process and restart.

Environment variables:
- PORT: Port to bind on (default 3001)
- HOST: Host to bind on (default 0.0.0.0)
- NODE_ENV: Typical values development|production|test
- MONGODB_URI: Mongo connection string. If missing/empty, the server still starts and reports db=disconnected on health routes.
- MONGODB_DB: Optional explicit DB name (defaults to “test” if not provided).
- MONGOOSE_AUTO_INDEX: 'true' to enable index auto-creation (defaults to false).
- SWAGGER_TITLE, SWAGGER_DESCRIPTION, SWAGGER_VERSION: Optional docs customization.

Useful endpoints:
- Health: GET /api/health and GET /health (returns 200 even if DB is disconnected; includes db state)
- Swagger UI: GET /api/docs
- OpenAPI JSON: GET /openapi.json and GET /api/docs.json

Notes:
- In production, behavior is strict: if the port is in use, the process logs an error and exits immediately.
- PID file: ./.tmp/server.<PORT>.pid is removed on graceful shutdown; stale PID is cleaned up automatically if the process is not alive.
- The app logs a concise startup banner: `[startup] listening http://0.0.0.0:3001 | db=(not connected)` then logs MongoDB connection events when MONGODB_URI is set.
- For local development, create a `.env` based on `.env.example` and set `MONGODB_URI`.
