# Backend environment notes (LLM costs tuning)

The following environment variables can be used to tune performance and avoid 504 timeouts for the LLM costs endpoint:

- LLM_COSTS_ROUTE_TIMEOUT_MS: Per-request timeout in milliseconds for GET /api/llm-costs (default: 12000)
- LLM_COSTS_MICRO_CACHE_TTL_MS: TTL in milliseconds for in-memory micro-cache on list responses (default: 1500)
- MICRO_CACHE_TTL_MS: Global TTL for list responses when specific TTL is not provided
- RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, RATE_LIMIT_SKIP_GET: Rate limiter tuning (see middleware/security.js)

CORS origins can be managed with:
- CORS_ORIGIN, CORS_ORIGINS (comma-separated), FRONTEND_ORIGIN
- CORS_CREDENTIALS: "true" to enable credentialed requests; note permissiveCors on /api uses "*"
