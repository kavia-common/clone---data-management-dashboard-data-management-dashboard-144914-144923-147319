# Dev server OOM mitigation notes

Summary of changes to reduce memory usage during `npm run dev`:
- Increased dev heap: NODE_OPTIONS=--max-old-space-size=2048 for dev/preview scripts only (prod remains 1024).
- Reduced watching overhead:
  - nodemon watches only `src/`
  - ignores node_modules, build/dist, coverage, test files and __tests__
  - CHOKIDAR_USEPOLLING=false to avoid polling (lower memory)
  - delay increased to 250ms to debounce rapid restarts
- Duplicate server safeguards:
  - src/server.js uses a PID file guard and EADDRINUSE handling to avoid double-starts that cause duplicate watchers.
- Optional diagnostics:
  - DEBUG_MEMORY=true logs a one-line memory snapshot on boot.

If OOM persists, investigate large collection loads and replace with paginated or streamed access.
