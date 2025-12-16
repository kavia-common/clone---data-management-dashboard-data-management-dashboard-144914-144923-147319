# LLM Costs Aggregation API

This backend now standardizes on the `llm_costs` MongoDB collection.

Environment:
- LLMCOSTS_COLLECTION_NAME (default: `llm_costs`) — override only if your DB uses a different name.

New endpoint:
- GET /api/costs/:organization_id
  - Returns an array of records with:
    organization_id, organization_name, organization_cost, users, user_id, type, user_cost, projects

Tenant scoping:
- Provide x-organization-id header or Authorization (JWT). The path `:organization_id` must match the resolved tenant or middleware will reject.
