# Backend runtime hardening

- Memory cap: NODE_OPTIONS=--max_old_space_size=512 applied in scripts to avoid spikes during dev.
- Browserslist update warnings suppressed via `postinstall`; backend does not depend on browserslist for runtime.
- No webpack/React dev server is launched by backend; scripts are scoped to start Express only (no source maps control needed).
- Lint/test are CI-friendly (non-watch, do not block or crash the build on warnings).
- HOST: If unset or set to 'localhost', the server forces binding to 0.0.0.0 for container/preview compatibility.
- For live reload in development use `npm run dev:watch` (nodemon). In CI/previews prefer `npm run dev` to avoid watchers.

Environment variables (set via .env by orchestrator, do not hardcode here):
- HOST, PORT, MONGODB_URI, MONGODB_DB, and REACT_APP_* are ignored by backend unless explicitly referenced.
