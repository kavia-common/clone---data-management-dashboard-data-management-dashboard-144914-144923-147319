# LLM Costs Endpoint Validation

Steps to validate and avoid 504s:

1) Ensure indexes (dev-only):
   curl -s http://localhost:3001/api/dev/llm-costs/ensure-indexes | jq

2) Seed sample costs if needed (dev-only):
   curl -s http://localhost:3001/api/dev/seed-llm-costs | jq

3) Sanity fetch with pagination and tenant:
   curl -s "http://localhost:3001/api/llm-costs?page=1&limit=20&sort=-timestamp" -H "x-organization-id: T0000" | jq

4) Expect 200 with envelope:
   { "success": true, "data": [...], "meta": { "page": 1, "limit": 20, "total": N } }

Operational changes:
- Default date window for unpaginated requests: last 14 days (header X-Default-Date-Window: last-14-days)
- Request timeout: 10s by default (LLM_COSTS_ROUTE_TIMEOUT_MS)
- Micro-cache TTL: default 40s for LLM costs (override via LLM_COSTS_MICRO_CACHE_TTL_MS)

Environment variables:
- LLM_COSTS_ROUTE_TIMEOUT_MS=10000
- LLM_COSTS_MICRO_CACHE_TTL_MS=40000
- To allow unbounded full scans without pagination (not recommended): ALLOW_UNBOUNDED_LLM_COSTS=true
