# /api/llm-costs performance notes

- Compound indexes created at runtime (migration-safe):
  - { tenant_id: 1, timestamp: -1 }, { organization_id: 1, timestamp: -1 }
  - Variants for user_id and project_id with timestamp:
    - { tenant_id: 1, user_id: 1, timestamp: -1 }, { organization_id: 1, user_id: 1, timestamp: -1 }
    - { tenant_id: 1, project_id: 1, timestamp: -1 }, { organization_id: 1, project_id: 1, timestamp: -1 }
  - Fallback sorts: created_at
  - Seek pagination support: { tenant_id: 1, timestamp: -1, _id: -1 } and org equivalent

- Aggregations:
  - Always place $match before $sort/$project/$group.
  - Projection limits payload: { _id, tenant_id, organization_id, user_id, project_id, llm_model, provider, total_cost, currency, timestamp, created_at }.

- Pagination:
  - Default sort aligned to index: -timestamp.
  - Skip is clamped (MAX_SKIP=5000) to avoid heavy offsets.
  - Index supports seek (timestamp + _id) if client later adds cursor params.

- Timeouts:
  - maxTimeMS from env MONGO_MAX_TIME_MS else 5000ms for LLMCost (10s otherwise).
  - countDocuments wrapped with try/catch; fallback to estimatedDocumentCount, then approximation.

- Diagnostics:
  - DEBUG_EXPLAIN=1 logs aggregate explain for verification of index usage.
  - Response headers: X-Skip-Clamped, X-Count-Approximate, X-Pagination-Defaulted, X-Limit-Clamped, X-Applied-Tenant, X-Model-Collection.

No API changes; behavior is internal optimization.
