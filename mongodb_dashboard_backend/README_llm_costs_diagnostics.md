# LLM Costs Diagnostics (GET /api/llm-costs)

This document explains the new diagnostics available for investigating slow queries and 504s on the LLM costs list endpoint.

What was added
- Effective filter, sort, projection, page, limit are emitted as response headers:
  - x-effective-tenant, x-llm-filter, x-llm-projection, x-llm-sort, x-llm-page, x-llm-limit, x-llm-used-or-on-time
- Timing headers:
  - x-llm-timing-parsed-ms, x-llm-timing-built-ms, x-llm-timing-exec-ms, x-llm-timing-explain-ms (when enabled)
- When DEBUG_LLMCOSTS_EXPLAIN=1 (set in environment):
  - MongoDB explain() collected for the request’s find and countDocuments (via driver; executionStats mode).
  - Response headers x-llm-explain-find and x-llm-explain-count indicate capture.
  - Response meta.debug includes summarized explain stats:
    - totalDocsExamined, totalKeysExamined, nReturned, executionTimeMillis, winningPlan, usedIndexes.
  - Example explain summaries for tenant T0015 are also included in meta.debug.explain.examples for:
    - No date filter (page=1, limit=10)
    - With date filter (last 7 days; same pagination)

How to use
1) Enable explains
   - Start the backend with env: DEBUG_LLMCOSTS_EXPLAIN=1
2) Call the endpoint
   - Use header x-organization-id or JWT-based tenant context.
   - Inspect response headers and meta.debug in JSON body.
3) Identify common causes of slowness
   - Or on time fields: x-llm-used-or-on-time=1 and usedOrOnTime=true. Wide $or can prevent index intersection.
   - Missing compound indexes: explain.summary.usedIndexes empty or uses COLLSCAN / FETCH -> add compound indexes.
   - Wide unbounded date windows: totalDocsExamined >> nReturned and high executionTimeMillis.

Concrete recommendations
- Normalize time at write for efficient sort and range:
  - Add normalizedTimestamp field on insert/update: normalizedTimestamp = timestamp || created_at
  - Index: { tenant_id: 1, normalizedTimestamp: -1 } and consider { organization_id: 1, normalizedTimestamp: -1 } if alias is common.
- If write-side normalization is not possible immediately:
  - Prefer a single time field in queries (timestamp) with a fallback migration that backfills missing values from created_at.
  - Alternatively, change read-side filter to use $ifNull within an aggregation to compute a sortKey but note limitations for pagination.
- Ensure tenant-first compound indexes to match query shape:
  - Already declared:
    - { tenant_id: 1, timestamp: -1 }
    - { tenant_id: 1, created_at: -1 }
  - Add when needed:
    - { organization_id: 1, timestamp: -1 } (exists)
    - { organization_id: 1, created_at: -1 } (optional)
    - Additional fields used for filtering frequently (llm_model/provider/status) can be included as suffixes when stable.
- Cap date windows for UI:
  - Enforce a max lookback (e.g., 90 days) server-side when from/to not provided to avoid scanning entire history.
- Validate pagination inputs:
  - Keep limit <= 200 (already enforced). Prefer default limit=50.

Operational steps
- Turn on DEBUG_LLMCOSTS_EXPLAIN=1 in staging.
- Hit endpoints with and without from/to.
- Collect headers, meta.debug and logs to see winningPlan, indexes, docs examined.
- Apply indexes indicated by winningPlan or adjust filters to match existing indexes.
- Optionally implement normalizedTimestamp write path and backfill migration for best performance.

Notes
- Avoid leaking full explain outputs in production; we log a truncated version and only ship summaries in meta.debug.
- For countDocuments(), pipeline count via aggregate + explain is used to capture executionStats uniformly.

