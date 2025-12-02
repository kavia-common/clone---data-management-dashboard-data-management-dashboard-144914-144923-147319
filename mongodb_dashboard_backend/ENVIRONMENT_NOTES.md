# Backend runtime hardening

- Memory caps:
  - dev: NODE_OPTIONS='--max_old_space_size=1536 --heapsnapshot-near-heap-limit=1'
  - dev:ci: NODE_OPTIONS='--max_old_space_size=1024 --heapsnapshot-near-heap-limit=1'
  - start/preview: NODE_OPTIONS='--max_old_space_size=2048~3072 --heapsnapshot-near-heap-limit=1'
- Browserslist warnings suppressed via `BROWSERSLIST_DISABLE_CACHE=1 BROWSERSLIST_IGNORE_OLD_DATA=1` and quiet `postinstall`. Backend does not rely on browserslist for runtime.
- No webpack/React dev server here; Express only. Source map controls are irrelevant for this container.
- Lint/test are CI-friendly (non-watch, do not block the build on warnings). Jest runs in-band to reduce memory pressure.
- HOST: If unset or 'localhost', bind is forced to 0.0.0.0 for container/preview compatibility.
- For live reload: `npm run dev:watch` (uses nodemon with `--legacy-watch` and delay to reduce watcher load). In CI/previews prefer `npm run dev` or `npm run dev:ci` (no watchers).

Recommended scripts:
- Local dev: `npm run dev` (or `dev:watch` when editing locally).
- CI/previews: `npm run dev:ci` to minimize resource usage and avoid file watchers.

Environment variables (set via .env by orchestrator, do not hardcode here):
- HOST, PORT, MONGODB_URI, MONGODB_DB (required for DB connectivity; server still starts without it).
