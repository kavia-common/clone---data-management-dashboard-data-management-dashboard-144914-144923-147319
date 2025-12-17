# /api/llm_costs (underscore) endpoint notes

- This endpoint returns a tabular list of raw documents from the `llm_costs` collection with optional filtering by `organization_id` and pagination.
- It intentionally does NOT assume nested fields like `users.*` or `users.projects.*` because the canonical collection schema used by the app is flat (one document per usage/cost entry).
- Default sort: newest first by `_id`.
- Response envelope: `{ success, data, meta: { page, limit, total, organization_id? } }`

Diagnostics:
- `X-LLM-COSTS-Collection`: effective collection name used by the Mongoose model (defaults to `llm_costs`, overridable by env).
- `X-LLM-COSTS-Total`: total matched documents.
- `X-LLM-COSTS-Reason`: present when no documents matched.

Environment:
- Override collection name with either `LLMCOSTS_COLLECTION_NAME` or `LLM_COSTS_COLLECTION` if your deployment uses a non-standard name.

Example:
GET /api/llm_costs?organization_id=b2c&page=1&limit=10

Returns 200 with:
{
  "success": true,
  "data": [ ... ],
  "meta": { "page": 1, "limit": 10, "total": 0, "organization_id": "b2c" }
}
