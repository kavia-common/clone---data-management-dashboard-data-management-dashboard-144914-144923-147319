# LLM Costs Endpoint Optimization and Diagnostics

This document summarizes operational toggles and diagnostics added to stabilize GET /api/llm-costs and help verify data and query plans.

Key points

- Collection naming: The backend prefers the `llm-costs` collection. If not found, it will automatically fall back to `llm_costs`. Ensure the dataset is stored in one of these names.
- Tenant scoping: The endpoint relies on `requireTenant` middleware. Tenant is resolved (in order): JWT tenant -> `x-organization-id` header -> `?organization_id`/`?tenant_id`. Super Admin can bypass scoping with `x-all-tenants: true` (T0000 equivalent).
- Fields: Supports `organization_id` for scoping and time fields `createdAt`, `created_at`, and `timestamp` for sorting/indexing.

Timeouts and readiness

- QUERY TIMEOUT: Controlled by `LLM_COSTS_QUERY_TIMEOUT_MS` (default 12000). The main list query uses this timeout; the count query uses a smaller cap (<=3000ms).
- READINESS BYPASS: When the DB quick readiness check fails but connectivity might be borderline, you can override the readiness gate with:
  - env: `LLM_COSTS_BYPASS_READINESS=true`
  - or for Super Admins, header: `x-admin-bypass-llm-costs: true`
  This will attempt the query even if the ping fails.
- TIMEOUT FALLBACK: If the primary paginated query times out, the controller will attempt a minimal fallback fetch (no maxTimeMS, smaller page) and return that data with a note.

Indexes

The controller and model ensure (non-blocking) indexes:
- `{ organization_id: 1, _id: -1 }`
- `{ organization_id: 1, createdAt: -1, _id: -1 }`
- `{ organization_id: 1, created_at: -1, _id: -1 }`

Diagnostics

- Admin diagnostics: `GET /api/llm-costs/_diagnostics`
  - Requires Super Admin or header `x-admin-diagnostics: true`.
  - Query/header tenant aliases supported.
  - Returns: total count, 5-doc sample projection, and current indexes.
- COLLSCAN detection: `X-LLM-Costs-Scan` response header will show `INDEX` or `COLLSCAN` based on an internal `explain()` run.

Example request for T0015

curl -H "Authorization: Bearer ok" \
     -H "x-organization-id: T0015" \
     "http://localhost:3001/api/llm-costs?page=1&limit=10"

Notes

- Ensure env vars MONGODB_URI and optionally MONGODB_DB are configured.
- For Super Admin all-tenant view, send `x-all-tenants: true` header (or tenant=T0000 in JWT).
- If you still see empty results, verify the tenant value in documents matches T0015 exactly in the `organization_id` field and that documents exist in `llm-costs` (or `llm_costs`) collection.
