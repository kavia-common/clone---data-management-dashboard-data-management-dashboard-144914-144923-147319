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

Troubleshooting (b2c org failures) – exact fixes applied:
1) Invalid $addFields: '$' by itself is not a valid FieldPath
   - Root cause: a malformed field path or accidental template interpolation produced a bare "$".
   - Fix: Audited all $addFields/$project/$set expressions to ensure every field path is a valid path string (e.g., "$field" or "$a.b.c"). No stage now uses "$" alone.
2) Failed to parse number '' in $convert with no onError value: Empty string
   - Root cause: documents had '' or whitespace strings in numeric fields like prompt_tokens, completion_tokens, input_cost, output_cost, total_cost.
   - Fix: Introduced an initial normalization stage using $addFields:
     - safePromptTokens, safeCompletionTokens, safeInputCost, safeOutputCost, safeTotalCost
     - Each uses {$convert: {input: <expr>, to: "double", onError: 0, onNull: 0}} coupled with guards to map ""/null/missing to 0.
     - Strings like "$12.34" or "1,234.56" are normalized via trim + strip "$" + remove commas before conversion.
3) Defensive pagination and sorting
   - Stable default sort by total_cost desc then user_cost desc to avoid sorting on missing fields.
   - Pagination variables are validated and clamped.

Verification:
- GET /api/llm_costs?organization_id=b2c&page=1&limit=10 now returns 200 with an empty array or valid results (no 500).
*/
