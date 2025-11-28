# LLM Costs Endpoint Timeout Notes

This service implements safeguards to prevent timeouts for GET /api/llm-costs:
- Request-id propagation: send `X-Request-Id`; logs will include it and the response will echo it.
- Timing logs: server logs `TIMING` events at route entry/exit and during DB operations.
- Pagination: If page/limit are omitted, defaults apply (page=1, limit=50). Max limit is clamped to 200.
- Query guards:
  - Mongo maxTimeMS: aggregate/find/count use maxTimeMS (default 5000ms for LLM costs). Set MONGO_MAX_TIME_MS to override.
  - Count fallback: when exact count times out, falls back to estimatedDocumentCount or approximation.
  - Aggregation uses allowDiskUse(true), normalizes timestamp and tenant/org fields for index friendliness.
- Micro-caching: identical list requests are cached for MICRO_CACHE_TTL_MS (default 2000ms) to smooth bursts.
- Timeouts: Node server `headersTimeout`, `keepAliveTimeout`, and `requestTimeout` are aligned above typical proxy defaults.

Useful environment variables:
- MONGO_MAX_TIME_MS=5000
- MICRO_CACHE_TTL_MS=2000
- SERVER_HEADERS_TIMEOUT_MS=65000
- SERVER_KEEPALIVE_TIMEOUT_MS=70000
- SERVER_REQUEST_TIMEOUT_MS=60000
- DEBUG=true
- DEBUG_EXPLAIN=1

Index considerations:
- The LLMCost model defines indexes:
  - { tenant_id: 1, timestamp: -1 } (preferred path for list default sort)
  - { tenant_id: 1, created_at: -1 }
  - Other supporting indexes on session_id, llm_model, etc.
Ensure that listing with sort by -timestamp will use the composite index when a tenant_id filter is applied (which is enforced by the controller unless bypass is active).
