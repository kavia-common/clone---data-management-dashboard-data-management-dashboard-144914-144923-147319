# /api/llm-costs optimization notes

This endpoint was optimized to prevent timeouts by:
- Applying early, index-backed sort/skip/limit on `{ organization_id: 1, _id: -1 }` (preferred) or `{ organization_id: 1, createdAt: -1 }`
- Minimizing projection before pagination to reduce I/O
- Batching user enrichment via a single query: `users.find({ _id: { $in: [...] } })` with string UUIDs (no ObjectId casting)
- Enforcing a query timeout from env `LLM_COSTS_QUERY_TIMEOUT_MS` (default 8000ms) and graceful 504 handling
- Adding env-guarded profiling logs with `LLM_COSTS_PROFILE=true` that will log timing and an `explain('executionStats')` summary

Recommended MongoDB indexes:
- On llm-costs:
  - `{ organization_id: 1, _id: -1 }` (preferred for pagination)
  - `{ organization_id: 1, createdAt: -1, _id: -1 }` (alternative)
  - Optional variants if your dataset uses different timestamp fields:
    - `{ organization_id: 1, timestamp: -1, _id: -1 }`
    - `{ organization_id: 1, created_at: -1, _id: -1 }`
- On users (optional but useful):
  - `{ _id: 1 }` (default)
  - If joining by `users.user_id` elsewhere, consider a partial index on `llm-costs.users.user_id` (already defined as sparse in the Mongoose model).

Environment variables:
- LLM_COSTS_PROFILE=true  # enable profiling logs and compact explain summary
- LLM_COSTS_QUERY_TIMEOUT_MS=8000  # set maxTimeMS for the main query and enrichment

Testing:
- Re-test GET `/api/llm-costs?organization_id=T0015&page=1&limit=10`
- Expect reduced latency and the response shape to remain intact:
  - With pagination: `{ success, data, meta: { page, limit, total } }`
  - Without pagination: raw array of cost documents
