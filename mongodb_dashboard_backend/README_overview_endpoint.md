# Overview Endpoint

## Dev runtime stability
- Dev server uses nodemon with minimal NODE_OPTIONS (`--max_old_space_size=384 --heapsnapshot-near-heap-limit=1`) and avoids inspector/source maps.
- Nodemon watches only `src/` with ~1000ms delay and ignores frontend, logs, coverage, caches.

## Quick verification
1) Start backend dev:
   npm run dev
2) Health:
   curl -sSf http://127.0.0.1:${PORT:-3001}/health
3) LLM costs:
   curl -sS "http://127.0.0.1:${PORT:-3001}/api/llm-costs?page=1&limit=10&organization_id=T0015"

Expected:
- /health returns 200 JSON { status: 'ok', ... }
- /api/llm-costs returns 200 with array or envelope within ~1s.
- If query exceeds time limit, endpoint returns 206 with minimal payload and meta.timedOut=true.
