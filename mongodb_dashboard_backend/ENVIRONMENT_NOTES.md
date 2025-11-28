# Backend runtime hardening

- Memory cap: NODE_OPTIONS=--max_old_space_size=512 applied in scripts to avoid spikes during dev.
- Browserslist update warnings suppressed via `postinstall`; backend does not depend on browserslist for runtime.
- No webpack/React dev server is launched by backend; scripts are scoped to start Express only (no source maps control needed).
- Lint/test are CI-friendly (non-watch, do not block or crash the build on warnings).
- HOST: If unset or set to 'localhost', the server forces binding to 0.0.0.0 for container/preview compatibility.
- For live reload in development use `npm run dev:watch` (nodemon). In CI/previews prefer `npm run dev` to avoid watchers.

Environment variables (set via .env by orchestrator, do not hardcode here):
- HOST, PORT, MONGODB_URI, MONGODB_DB; REACT_APP_* are ignored by backend unless explicitly referenced.

## Performance and Timeouts

- SERVER_HEADERS_TIMEOUT_MS: Default 65000. Increases Node server headers timeout above common proxy 60s.
- SERVER_KEEPALIVE_TIMEOUT_MS: Default 70000.
- SERVER_REQUEST_TIMEOUT_MS: Default 60000. Keep this slightly below proxy if proxy enforces idle timeouts.

- MONGO_MAX_TIME_MS: Max time (ms) for MongoDB operations (aggregate/find/count). Default 5000 for LLMCosts and 10000 for others.

- MICRO_CACHE_TTL_MS: In-memory micro-cache TTL (ms) for list endpoints. Default 2000.

## Diagnostics

- DEBUG=true enables additional logs.
- DEBUG_EXPLAIN=1 will execute aggregate explain() for list queries and log the first ~4000 chars of the explain plan.
- X-Request-Id: You can pass a request id in header; the backend will propagate it and include timing logs.

## Pagination Guardrails

- List endpoints enforce maximum page sizes. For /api/llm-costs, max limit is 200. The service may clamp larger values.
