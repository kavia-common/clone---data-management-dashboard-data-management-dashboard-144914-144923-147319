# Backend runtime hardening

- Memory cap: NODE_OPTIONS=--max_old_space_size=512 applied in scripts.
- Browserslist noise suppressed via `postinstall` and update disabled for backend context.
- No webpack/React dev server is launched by backend; scripts are scoped to start Express only.
- Lint/test are CI-friendly (non-watch, do not block or crash the build on warnings).

Environment variables (set via .env by orchestrator, do not hardcode here):
- HOST, PORT, MONGODB_URI, MONGODB_DB, and REACT_APP_* are ignored by backend unless explicitly referenced.
