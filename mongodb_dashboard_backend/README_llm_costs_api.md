# LLM Costs API Performance Notes

This implementation of GET /api/llm-costs is optimized to avoid 504s:
- Uses a single indexed predicate: either { tenant_id, timestamp } or { organization_id, timestamp } depending on LLMCOSTS_USE_ORG_ALIAS.
- Enforces a bounded time window on canonical field timestamp (default 90 days, clamped).
- Defaults diagnostics=false to reduce header and processing overhead. When diagnostics=false, countDocuments is skipped.
- Cursor is tuned with maxTimeMS and batchSize (configurable).
- Short-circuits requests exceeding internal handler timeout with 504 and timing headers.
- TEMP (debug): Route-scoped timeout for GET /api/llm-costs set to 5 minutes (300000 ms) by default. This does NOT change global server timeouts.

Environment variables:
- LLMCOSTS_MAX_DAYS_WINDOW (default 90)
- LLMCOSTS_MAX_ALL_LIMIT (default 20000)
- LLMCOSTS_CURSOR_BATCH_SIZE (default 500)
- LLMCOSTS_MAX_TIME_MS (default 8000)
- LLMCOSTS_HANDLER_TIMEOUT_MS (default 9500)
- LLMCOSTS_USE_ORG_ALIAS (default false). If true, the route will use organization_id instead of tenant_id for the indexed predicate.
- LLM_COSTS_ROUTE_TIMEOUT_MS_OVERRIDE (optional). TEMP override for GET /api/llm-costs route timeout in ms (e.g., 300000).

Testing curl:
curl -sS "http://localhost:8080/api/llm-costs?page=1&limit=10&organization_id=T0015"

Notes:
- To enable diagnostics (adds headers and total count), append ?diagnostics=true.
- If you need all results up to a cap, use limit=all or all=true. The server caps using LLMCOSTS_MAX_ALL_LIMIT.

## TEMP: Route-scoped timeout override and diagnostics

A temporary, per-route timeout is applied only to GET /api/llm-costs. Default is 300000 ms (5 minutes). It does not affect any other routes or global server timeouts.

Priority of timeout sources (highest to lowest):
1) Query param: ?timeout_ms=NNN (for ad-hoc testing; must be >0 and <= 600000)
2) Environment: LLM_COSTS_ROUTE_TIMEOUT_MS_OVERRIDE=NNN
3) Default TEMP value: 300000 (5 minutes)
4) Fallback: LLMCOSTS_HANDLER_TIMEOUT_MS if set (legacy behavior)

Diagnostic headers added when this route is hit:
- x-llm-timeout-ms: Effective timeout in ms for this execution.
- x-llm-timeout-source: "query" | "env" | "default" indicating the source of the applied timeout.
- Existing timing headers: x-llm-timing-parsed-ms, x-llm-timing-built-ms, x-llm-timing-exec-ms
- Existing context headers: x-effective-tenant, x-llm-filter, x-llm-projection, x-llm-sort, x-llm-page, x-llm-limit, x-llm-window-*

504 behavior:
- If the handler exceeds the effective timeout, the route returns 504 with JSON:
  { success: false, error: "timeout", message: "The request exceeded the time limit. ..." }
- Headers above are included to assist debugging.

How to revert:
- Remove LLM_COSTS_ROUTE_TIMEOUT_MS_OVERRIDE from the environment (or set it to the prior smaller value, e.g., 5000).
- Optionally remove any usage of ?timeout_ms from callers.
- The code comments in llmCosts.list.controller.js are marked with "TEMP" to aid cleanup; search for "TEMP_DEFAULT_ROUTE_TIMEOUT_MS".

