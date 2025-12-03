# LLM Costs API Performance Notes

This implementation of GET /api/llm-costs is optimized to avoid 504s:
- Uses a single indexed predicate: either { tenant_id, timestamp } or { organization_id, timestamp } depending on LLMCOSTS_USE_ORG_ALIAS.
- Enforces a bounded time window on canonical field timestamp (default 90 days, clamped).
- Defaults diagnostics=false to reduce header and processing overhead. When diagnostics=false, countDocuments is skipped.
- Cursor is tuned with maxTimeMS and batchSize (configurable).
- Short-circuits requests exceeding internal handler timeout with 504 and timing headers.
- Best-effort ensureLlmCostsIndexes() is fired in the background.

Environment variables:
- LLMCOSTS_MAX_DAYS_WINDOW (default 90)
- LLMCOSTS_MAX_ALL_LIMIT (default 20000)
- LLMCOSTS_CURSOR_BATCH_SIZE (default 500)
- LLMCOSTS_MAX_TIME_MS (default 8000)
- LLMCOSTS_HANDLER_TIMEOUT_MS (default 9500)
- LLMCOSTS_USE_ORG_ALIAS (default false). If true, the route will use organization_id instead of tenant_id for the indexed predicate.

Testing curl:
curl -sS "http://localhost:8080/api/llm-costs?page=1&limit=10&organization_id=T0015"

Notes:
- To enable diagnostics (adds headers and total count), append ?diagnostics=true.
- If you need all results up to a cap, use limit=all or all=true. The server caps using LLMCOSTS_MAX_ALL_LIMIT.
