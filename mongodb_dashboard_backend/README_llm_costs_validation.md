# LLM Costs Listing and Validation

This document provides notes to validate LLM costs endpoints, especially GET /api/llm-costs listing which was optimized to prevent timeouts and to ensure the UI can render tabular data reliably.

## GET /api/llm-costs (List - Tabular)

- Requires tenant scope:
  - With JWT: tenant is enforced from the token; conflicting query/header tenant returns 403.
  - Without JWT (testing/demo): include header `x-organization-id: <TENANT>` (e.g., `T0015`). Query aliases `?organization_id` or `?tenant_id` are accepted but the header takes precedence and is recommended.
- Supports:
  - Pagination: `page` (default 1), `limit` (default 50, max 200)
  - Sorting: `sort` in { `timestamp`, `created_at`, `_id`, `total_cost` } with optional `-` for desc (default `-timestamp`)
  - Filters (whitelisted): `status`, `provider`, `llm_model`, `user_id`, `session_id`, `project_id`, `request_id`
  - Date range: `from`, `to` (ISO strings) applied to `timestamp` only (created_at is retained for display fallback)
- Defaults to a capped date window when no `from`/`to` is provided (MAX_DAYS_WINDOW; default 90 days) to avoid full scans. If only one bound is provided, the other is clamped so the window does not exceed MAX_DAYS_WINDOW. If both are provided and exceed the window, the server returns 400.
- Always returns an envelope:
  {
    "success": true,
    "data": [
      {
        "_id": "65f0...",
        "request_id": "req_123",
        "timestamp": "2025-01-12T08:43:10.120Z",
        "model": "gpt-4o-mini",
        "provider": "openai",
        "user_id": "user_1",
        "organization_id": "org_1",
        "tokens_in": 123,
        "tokens_out": 456,
        "cost_usd": 0.01234,
        "duration_ms": 842,
        "status": "success"
      }
    ],
    "meta": { "page": 1, "limit": 50, "total": 1234, "sort": "-timestamp" }
  }

### Sample curl (no JWT; use header)
curl -sS -H "x-organization-id: T0015" \
  "http://localhost:3001/api/llm-costs?page=1&limit=10"

### Performance expectations
- Endpoint enforces indexed filters and projections; expected response time is under 2 seconds for typical datasets and a 10–50 row page.
- Uses compound index { tenant_id:1, timestamp:-1 } or { organization_id:1, timestamp:-1 } declared in the model; projections minimize payload.
- When `DEBUG_LLMCOSTS_EXPLAIN=1` is enabled, explain summaries are captured and helpful response headers are added for debugging.

### HTTP headers
- x-effective-tenant: Resolved tenant id
- x-llm-window-*: Default/clamped window details (x-llm-window-from, x-llm-window-to, x-llm-window-max-days, etc.)
- x-llm-filter: Effective Mongo filter used (JSON)
- x-llm-projection: Projection applied (JSON)
- x-llm-sort: Sort applied (JSON)
- x-llm-page: Page number
- x-llm-limit: Page size
- x-llm-timing-parsed-ms / x-llm-timing-built-ms / x-llm-timing-exec-ms: Timing breakdowns
- x-llm-explain-find / x-llm-explain-count: Present when DEBUG_LLMCOSTS_EXPLAIN=1
- x-llm-explain-*-summary: Summarized index usage when explains are enabled

## Known fields in the collection (tabular projection)
- _id, request_id, timestamp, model, provider, user_id, organization_id, tokens_in, tokens_out, cost_usd, duration_ms, status
- Additional: llm_model, project_id, session_id, created_at (fallback display only)

Ensure at least one of timestamp/created_at exists for proper sorting.

## Diagnostics and Slowdown Triage

- If a 504/5xx or timeout occurs:
  1) Retry with a smaller limit (e.g., `limit=5`) and/or a narrower window (e.g., `from` last 7 days).
  2) Enable `DEBUG_LLMCOSTS_EXPLAIN=1` and retry; check:
     - Headers `x-llm-explain-find`, `x-llm-explain-count` (should show "captured")
     - Headers `x-llm-explain-*-summary` for `usedIndexes` including the tenant+timestamp compound index.
  3) Fetch last diagnostics snapshot (lightweight, no DB query):
     GET /api/llm-costs/diagnostics/last
- Common causes:
  - Missing compound index on (tenant|organization)_id + timestamp
  - Excessive date window without bounds
  - Non-whitelisted filters or unsafe sorts (server overrides to timestamp)

