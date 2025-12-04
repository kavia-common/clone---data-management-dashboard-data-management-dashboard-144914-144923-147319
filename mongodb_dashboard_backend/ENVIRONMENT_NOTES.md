# Environment Notes

Optional env vars:
- DISABLE_WATCH=1  (default set in npm run dev) prevents nodemon-like watching in CI
- NODE_OPTIONS="--max-old-space-size=512"  caps memory to avoid OOM/kill
- DEBUG_LLMCOSTS_EXPLAIN=1  enables explain() capture for /api/llm-costs

## Session Tracking Performance Flags

These flags tune GET /api/session-tracking behavior (safe defaults provided):
- ENABLE_ROUTE_CACHE=true        Enable short-lived in-memory route cache for identical queries.
- CACHE_TTL_SECONDS=60           TTL for the above cache (30–60s recommended).
- ENABLE_ETAG=true               Enable strong ETag generation and If-None-Match handling.
- ENABLE_RESPONSE_COMPRESSION=true  Enable gzip/brotli compression middleware globally.

Notes:
- Cache keys normalize start/end (round to minute), include tenant_id, page, limit, q, sort.
- Cache invalidation occurs automatically on POST/PUT/DELETE to /api/session-tracking.
- Responses include Cache-Control: public, max-age=<TTL>, must-revalidate when caching is enabled.
- ETag is a SHA1 over a compact signature of the response (length, first/last ids, max updated).

## Memory and Dev Stability

To prevent the dev server from being killed (OOM/kill -9), the npm scripts are already configured to cap memory and avoid heavy tooling.

- Start commands:
  - Production-like lean: `npm run start:ci` (sets NODE_OPTIONS="--max-old-space-size=384 --heapsnapshot-near-heap-limit=1")
  - Development lean: `npm run dev:lean`
  - Development with watch: `npm run dev` (uses nodemon but ignores tests and heavy paths)
- Source maps are disabled in these scripts to reduce memory: `GENERATE_SOURCEMAP=false`
- Browserslist cache is disabled where applicable to avoid heavy postinstall updates.

Environment variables affecting startup:
- HOST=0.0.0.0 (default in scripts)
- PORT=3001 (change as needed)
- NODE_ENV=production|development|test
- NODE_OPTIONS="--max-old-space-size=384 --heapsnapshot-near-heap-limit=1" (do not exceed small container memory)
- CI=true in CI context

## Health Check

A lightweight health endpoint is available:

- GET /api/health (aliases: /health, /healthz, /ready)
- Returns: `{ status: 'ok', db: 'connected|connecting|disconnected', timestamp, pid }`

Use it to verify that the server remains alive under constrained memory.

## LLM Costs Endpoint Instrumentation

The GET /api/llm-costs route contains optional performance instrumentation:

- Set LLM_COSTS_DEBUG=true to include MongoDB explain() executionStats for both the find and the countDocuments paths in the response meta.debug payload, and to emit compact execution stats in headers.
- Set LLM_COSTS_ROUTE_TIMEOUT_MS=12000 (default) to adjust the route-level timeout guard that returns 408 if the handler exceeds the budget.
- Set DEFAULT_PAGE_LIMIT=50 (default) to change the default page size (capped at 200).

Recommendations for production:
- Keep LLM_COSTS_DEBUG=false by default to avoid overhead.
- Prefer client-provided date windows (?from, ?to) to reduce scanned keys.
- Page size should be <= 200.
- Ensure the following indexes are present on the llm-costs collection:
  - { tenant_id: 1, timestamp: -1 }
  - { tenant_id: 1, created_at: -1 }
  - { organization_id: 1, timestamp: -1 } (for legacy alias)
- Consider adding a precomputed normalizedTimestamp field and index { tenant_id: 1, normalizedTimestamp: -1 } to eliminate $or on date fields.
