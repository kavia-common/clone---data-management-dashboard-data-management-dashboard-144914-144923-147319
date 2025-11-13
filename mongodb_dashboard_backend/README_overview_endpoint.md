# Backend Overview and Debugging Notes

This document provides quick reference notes for debugging tenant-scoped endpoints, especially `/api/llm-costs`.

## Tenant Scoping

Tenant scoping is enforced for all protected routes using `verifyAuth` and `requireTenant` middleware.

Precedence for tenant resolution:
1. JWT (req.auth.tenantId) – cannot be overridden by headers or query.
2. Headers: `x-organization-id` (preferred), `x-tenant-id`, `x-tenant`, or header alias `organization_id`.
3. Query aliases: `tenant_id` (preferred), `organization_id` (legacy).
4. In non-production with `ALLOW_DEMO_AUTH=true`, missing Authorization may be allowed using header/query to set tenant for demo usage.

Additionally supported aliases (camelCase) in headers or query:
- `tenantId`
- `organizationId`

When Authorization is provided and a conflicting tenant is passed in header/query, the request is rejected with `403: Forbidden: tenant scope mismatch`.

## /api/llm-costs endpoint

- List costs (GET): `/api/llm-costs`
  - Optional `page` and `limit` enable envelope response `{ success, data, meta }`.
  - Without pagination params, returns a raw array.
  - Filtering: use `filter` query as JSON string; tenant fields in the filter are ignored. The server injects an enforced tenant filter.
  - Sorting: `sort` supports a safe whitelist (`timestamp`, `created_at`, `_id`). Default: `-timestamp` (indexed).
- Create (POST) and single-record GET/PUT/DELETE are tenant-scoped similarly.

Debugging:
- Responses include:
  - `X-Applied-Tenant`: resolved tenant as a string.
  - `X-Applied-Filter`: the final applied MongoDB filter with normalized tenant matches.
  - `X-Model-Collection`: the collection name backing the model (e.g., `llm-costs`).
  - `X-Exists-Sample`: indicates whether at least one document exists for the applied filter (`true`/`false`/`error`).

## Common Causes for Empty Results

- Authorization present but JWT tenant does not match requested tenant in header/query; server returns 403 (if mismatch) or enforces JWT tenant.
- The dataset stores tenant only under `tenant_id` while clients attempt to filter differently. The server uses a normalized OR across common aliases: `tenant_id`, `organization_id`, `orgId`, `tenantId`, `organizationId`, `tenant.tenant_id`.
- Passing invalid JSON in `filter` results in `400: Invalid filter JSON`.
- Missing tenant scope (no JWT and no header/query) results in `400: Missing tenant scope`.

## Example Requests

- Without Authorization (demo) using query parameter:
  - `GET /api/llm-costs?organization_id=ORG1&page=1&limit=10`
  - `GET /api/llm-costs?tenant_id=ORG1`
  - `GET /api/llm-costs?organizationId=ORG1` (camelCase supported)

- With Authorization (JWT must contain tenantId or compatible claim):
  - `GET /api/llm-costs` (the tenant is taken from JWT)
  - Any attempt to pass a different tenant via query/header will be rejected with 403.

## Model and Indexes

- Model: `LLMCost` (collection: `llm-costs`), indexed on `tenant_id`, `timestamp`, `created_at`, etc.
- Default sort: `-timestamp` leverages compound index `{ tenant_id: 1, timestamp: -1 }`.

## Test Coverage

- A Jest test at `src/routes/__tests__/llmCosts.route.test.js` inserts a sample document with `tenant_id` and verifies:
  - `GET /api/llm-costs?organization_id=...` returns data in envelope mode.
  - CamelCase alias `organizationId` also works and returns a raw array.

Ensure `ALLOW_DEMO_AUTH=true` in non-production environments when testing without Authorization headers.
