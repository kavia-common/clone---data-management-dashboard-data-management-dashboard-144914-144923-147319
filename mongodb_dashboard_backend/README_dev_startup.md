# Backend Dev/Start Stability Notes

- Entry point: `src/server.js` (Express). No CRA/webpack-dev-server is used here.
- Memory cap: Node is started with `NODE_OPTIONS=--max_old_space_size=256` in all scripts to reduce footprint.
- Dev scripts:
  - `npm run dev` — plain node, minimal watchers.
  - `npm run dev:watch` — nodemon with `--legacy-watch` and limited to `src` to avoid high CPU/memory.
- Health endpoints (no auth):
  - `GET /health` (aliases: `/healthz`, `/ready`, `/api/health`, `/live`)
- OpenAPI/Swagger:
  - UI: `/api-docs` (aliases: `/docs`, `/api/docs`)
  - JSON: `/openapi.json` or `/api-docs.json`
- Session Tracking endpoints:
  - `GET /api/session-tracking`
  - `POST /api/session-tracking`
  - `GET /api/session-tracking/{id}`, etc.

Verify after start:
1) `npm run dev` (or `npm start` for production mode).
2) Wait for the log line: `READY: http://HOST:PORT`.
3) Health check: `curl http://127.0.0.1:${PORT:-3001}/health`.
4) Session tracking list (example, unauth/demo environments may require headers/tenant depending on middleware): `curl http://127.0.0.1:${PORT:-3001}/api/session-tracking`.

Graceful shutdown: SIGINT/SIGTERM closes HTTP server and Mongo connection and clears PID file (`.tmp/server.<port>.pid`).
