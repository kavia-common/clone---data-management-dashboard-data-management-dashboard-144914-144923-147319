# LLM Costs API and Collection Standard

The backend standardizes on the MongoDB collection name `llm_costs` (underscore). All LLM costs endpoints expect data in this collection.

Environment overrides:
- Preferred: `LLMCOSTS_COLLECTION_NAME`
- Legacy fallback supported: `LLM_COSTS_COLLECTION`
- Default when unset: `llm_costs`

Example:
```
# Default (underscore)
LLMCOSTS_COLLECTION_NAME=llm_costs
# or point to your existing collection if different
# LLMCOSTS_COLLECTION_NAME=my_llm_costs
```

Endpoints of interest:
- GET /api/llm-costs
  - Returns a paginated envelope { success, data, meta } with tenant scoping.
  - Pagination and sorting are applied after the $match for tenant and time window.
  - Projection includes common fields for tabular display.
- GET /api/llm-costs/hierarchy
  - Returns hierarchical aggregation per user -> projects -> agents with per-date breakdowns.
- GET /api/costs/:organization_id
  - Aggregated costs by organization (see README_costs for details).

Tenant scoping:
- Provide Authorization (JWT) to derive tenant or x-organization-id header if no JWT.
- Query aliases (organization_id, tenant_id) are accepted but header/JWT take precedence.
- When JWT is present and conflicts with query/header, the request is rejected with 403.

Diagnostics (for troubleshooting empty results):
- The list endpoint may include headers such as:
  - x-effective-tenant: resolved tenant id.
  - x-llm-fallback: 'native' when primary Mongoose path returns zero and native probe is used.
  - x-llm-fallback-collection: the collection name used in fallback.
  - x-llm-probed-collection: the collection last probed.
  - x-llm-tenant-matched: count of tenant-only matches (ignoring date window).
  - x-llm-total-matched: count matching full filter.
  - x-llm-debug-sample: a sample document (present in specific debug scenarios).
- Set LLMCOSTS_COLLECTION_NAME to align the model with your existing collection when fallback indicates a different name.
