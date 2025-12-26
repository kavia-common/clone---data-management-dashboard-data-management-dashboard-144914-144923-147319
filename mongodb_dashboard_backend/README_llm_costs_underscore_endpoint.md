# PUBLIC_INTERFACE
/** GET /api/llm_costs (underscore version)
This route lists raw documents from the llm_costs collection with minimal enrichment. It is separate from /api/llm-costs (dash) which includes broader projections and joins.

Key behavior and guardrails:
- Requires no auth; optional tenant filter via ?organization_id or ?tenant_id (string values only).
- Pagination: page and limit must be positive integers. Defaults: page=1, limit=10; limit is clamped to 100.
- Sorting: stable default by _id desc.
- Defensive error handling:
  - Returns 400 on invalid pagination or non-string tenant params.
  - Wraps DB operations in try/catch and returns 400 for known cast/validation issues, else 500.
- Documents are returned as-is, with a derived agents: string[] computed from nested users[].projects[].agents[*].(agent_name|name).

Diagnostics:
- X-LLM-COSTS-Collection, X-LLM-COSTS-Total, x-effective-tenant (if provided)

Manual verification examples:
- GET /api/llm_costs?organization_id=b2c&page=1&limit=10
- GET /api/llm_costs?tenant_id=org_abc&page=1&limit=5
- GET /api/llm_costs?page=1&limit=10 (no tenant filter)

Notes:
- This endpoint intentionally does not enforce JWT tenant scope; prefer /api/llm-costs for scoped behaviors.
*/
