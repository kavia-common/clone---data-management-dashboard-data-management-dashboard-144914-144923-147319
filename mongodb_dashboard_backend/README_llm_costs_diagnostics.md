# LLM Costs Diagnostics

This service defaults to the `llm_costs` (underscore) collection. Set LLMCOSTS_COLLECTION_NAME to override.

Troubleshooting empty responses (e.g., GET /api/llm-costs?organization_id=b2c):
- Ensure the tenant header or query resolves to the expected tenant.
- Pagination and sorting are applied after $match (tenant + date window) to avoid excluding all results.
- A case-insensitive tenant match is applied as a fallback in both the list and hierarchy paths.
- Diagnostics headers:
  - x-effective-tenant: final tenant id used.
  - x-llm-probed-collection: collection probed via native fallback.
  - x-llm-fallback-collection: final collection used when fallback triggers.
  - x-llm-tenant-matched: number of docs that match tenant regardless of date window.
  - x-llm-total-matched: number of docs matching full filter.
  - x-llm-debug-sample: sample matched document for quick inspection (when tenant=b2c).
- Projection includes: organization_id, organization_name, total_cost, currency, users and projects groupings in hierarchy responses as described in OpenAPI.

Pagination defaults:
- page=1, limit defaults to DEFAULT_PAGE_LIMIT (50 if unset) and max 200.
- All pagination stages occur after $match (tenant/date window).

If primary (Mongoose) returns zero but fallback finds data:
- Set LLMCOSTS_COLLECTION_NAME to the collection reported in `x-llm-fallback-collection`.
- Verify indexes on tenant_id and timestamp to improve performance.
