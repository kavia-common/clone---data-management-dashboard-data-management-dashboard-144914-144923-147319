# Backend Dev/Build Stability Notes

This backend is optimized to run in low-memory CI/dev environments where OOM-kill (-9) could occur.

Key changes:
- Cap Node heap and enable near-heap-limit snapshots for early GC:
  - NODE_OPTIONS="--max-old-space-size=384 --heapsnapshot-near-heap-limit=1"
- Disable heavy source maps in dev/CI: GENERATE_SOURCEMAP=false
- Avoid watch mode in CI: use `npm run start:ci`
- Use nodemon only in local dev with light ignores and limited watch paths
- Added a health route fallback at GET /api/health to enable simple curl probes
- Skip long Browserslist DB update during CI; update locally if needed

Scripts:
- npm run dev: Local development with nodemon, memory-capped, source maps disabled
- npm run dev:lean: Local dev without nodemon (lowest footprint)
- npm start: Production-like run with capped memory
- npm run start:ci: CI-safe run (no watch, capped memory)
- npm run health: Simple health probe against PORT (default 3001)

Browserslist DB:
- We don't auto-run heavy update during postinstall in CI. To update locally:
  npx update-browserslist-db@latest --yes

Verification steps:
1) npm ci
2) npm run dev (or npm run start:ci in CI)
3) curl http://localhost:3001/api/health
4) Confirm process stays running and no early exit due to OOM.

Memory tips:
- If you still see memory pressure, reduce max-old-space-size from 512 to 384 (or 256) for dev and prefer `npm run dev:lean`.
- Ensure external tools (like mongod, other services) do not compete for memory on the same runner.
