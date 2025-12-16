# GET /api/llm_costs (underscore) — Full nested documents

This endpoint now returns raw/full documents from the llm_costs collection (underscore), without any aggregation that alters the structure.

Behavior:
- Collection: defaults to llm_costs. Environment overrides:
  - LLMCOSTS_COLLECTION_NAME or LLM_COSTS_COLLECTION
- Filtering:
  - Optional query param organization_id for exact match:
    GET /api/llm_costs?organization_id=org_123
- Pagination:
  - page >= 1 (default 1)
  - limit > 0 (default 10), clamped to max 100
  - Response includes { meta: { page, limit, total, organization_id? } }
- Sorting:
  - Stable default sort by _id descending (newest first)
- Response:
  {
    "success": true,
    "data": [ <raw docs with all nested arrays/fields preserved> ],
    "meta": { "page": 1, "limit": 10, "total": 42, "organization_id": "org_123" }
  }

Notes:
- Currency strings remain as-is (e.g., "$2.519490") — no parsing is performed server-side.
- Minimal diagnostic headers may be included:
  - X-LLM-COSTS-Collection: effective MongoDB collection name
  - X-LLM-COSTS-Total: total documents matching the filter
