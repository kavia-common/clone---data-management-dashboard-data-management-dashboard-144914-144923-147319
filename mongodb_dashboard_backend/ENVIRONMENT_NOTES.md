# Backend runtime hardening and dev/proxy notes

This backend is designed to run reliably in containerized dev/preview environments and behind a frontend dev proxy.

Key runtime behavior
- Binding: The server binds to 0.0.0.0 by default. You can override via HOST, but 0.0.0.0 is strongly recommended inside containers to avoid EADDRNOTAVAIL.
- Port: Default PORT is 3001.
- Trust proxy: Enabled by default (app.set('trust proxy', 1)). Override with REACT_APP_TRUST_PROXY=0 to disable if needed.
- Readiness markers: On boot, logs include markers such as READY: http://HOST:PORT and Listening on http://HOST:PORT to aid orchestrators.
- PID file: A pid file is written to .tmp/server.<port>.pid and cleaned up on shutdown.
- Network error hardening: Transient proxy network errors (EADDRNOTAVAIL, EHOSTUNREACH, ECONNRESET) are caught and logged without crashing the process.

CORS configuration
- A computed whitelist is derived from:
  - CORS_ORIGIN (single origin)
  - CORS_ORIGINS (comma-separated origins)
  - FRONTEND_ORIGIN (single origin)
  - REACT_APP_API_BASE_URL (origin derived if present)
- Local defaults always include:
  - http://localhost:3000
  - https://localhost:3000
- A permissive CORS layer is applied on /api via permissiveCorsMiddleware to support non-credentialed cross-origin usage.
- To allow credentials (cookies/authorization), set CORS_CREDENTIALS=true and specify explicit origins via the envs above (avoid Access-Control-Allow-Origin: * with credentials).

Frontend dev proxy guidance
- Target: http://localhost:3001
- Options:
  - changeOrigin: true
  - secure: false (for https dev servers proxying to http backend)
- Use modern devServer.setupMiddlewares (webpack-dev-server >= 4) rather than deprecated onBeforeSetupMiddleware/onAfterSetupMiddleware.
- Add a proxy error handler that ignores these transient errors: ECONNRESET, EHOSTUNREACH, EADDRNOTAVAIL to avoid crashing the frontend dev server. Example:
  proxy.on('error', (err) => {
    if (['ECONNRESET','EHOSTUNREACH','EADDRNOTAVAIL'].includes(err.code)) {
      console.warn('[proxy] transient error:', err.code);
      return;
    }
    console.error('[proxy] fatal error', err);
  });

Memory footprint and dev stability
- Node memory: NODE_OPTIONS=--max_old_space_size=512 is set in scripts to cap memory usage in dev/preview.
- Nodemon: Prefer npm run dev:watch locally; in CI/preview use npm run dev (no watcher). Nodemon ignores large and non-source directories (node_modules, dist, build, coverage, docs, assets, tests) to reduce watchers and memory usage.

Environment variables used (set via .env by orchestrator)
- HOST (default 0.0.0.0), PORT (default 3001)
- MONGODB_URI, MONGODB_DB
- CORS_ORIGIN, CORS_ORIGINS, FRONTEND_ORIGIN, CORS_CREDENTIALS
- REACT_APP_API_BASE_URL (used for origin inference)
- REACT_APP_TRUST_PROXY (set to '0' to disable trust proxy)
