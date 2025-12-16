# New LLM Costs Aggregation API (underscore)

Endpoint:
- GET /api/llm_costs?organization_id=<id>

Behavior:
- Aggregates the `llm_costs` collection filtered by organization_id (case-insensitive fallback).
- One row per user with fields:
  organization_id, organization_name, organization_cost, users, user_id, type, user_cost, projects.
- Organization-level aggregates (organization_cost, users count) are included on every row.
- Default collection name is `llm_costs` (underscore). You may override via `LLMCOSTS_COLLECTION_NAME` or `LLM_COSTS_COLLECTION` envs, but underscore remains the enforced default across the codebase.

Notes:
- Existing `/api/llm-costs` endpoints remain untouched.
- This route is mounted at `/api/llm_costs`.
