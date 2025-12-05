# LLM Costs Diagnostics and Fallback

This backend implements a safe, read-only fallback path for `/api/llm-costs` when the primary Mongoose query returns zero matched records.

What happens:
- The primary path uses Mongoose and the configured model to query the LLM costs.
- If `total===0`, the server uses the native MongoDB driver to probe both `llm-costs` and `llm_costs` collections.
  - The probe first checks if any data exists for the resolved tenant (ignores date window).
  - If tenant data exists, it then applies the same time window, projection, sort, and pagination and returns results.
- When fallback returns data, response headers include:
  - `x-llm-fallback: native`
  - `x-llm-fallback-collection: <collectionName>`
  - `x-llm-fallback-warning: Primary path returned 0; using native probe results. Configure LLMCOSTS_COLLECTION_NAME accordingly.`

Configuration:
- Set `LLMCOSTS_COLLECTION_NAME` to the collection holding data for your deployment, e.g.:
  - `LLMCOSTS_COLLECTION_NAME=llm_costs` or `LLMCOSTS_COLLECTION_NAME=llm-costs`

Tenant matching:
- The filter tries the following fields: `tenant_id`, `organization_id`, `orgId`, `tenantId`, `organizationId`, and nested `tenant.tenant_id`.
- Default date window is applied to the canonical `timestamp` only and is clamped based on `MAX_DAYS_WINDOW`.

OOM and graceful shutdown diagnostics:
- The server logs memory usage on `uncaughtException`, `unhandledRejection`, `SIGINT`, `SIGTERM`.
- When errors include `ENOMEM` or `heap out of memory`, the server logs a specific hint to increase memory or optimize queries.
- In development, `npm run dev` uses `nodemon --exitcrash` so that OOM exits are not silently masked.
- Optional: set `DEBUG_MEMORY_LOG=1` to log memory usage every 30 seconds.

```env
# Example
LLMCOSTS_COLLECTION_NAME=llm_costs
MAX_DAYS_WINDOW=90
DEFAULT_PAGE_LIMIT=50
DEBUG_MEMORY_LOG=0
```
