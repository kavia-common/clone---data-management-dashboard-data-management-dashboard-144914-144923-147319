# LLM Costs Listing Hardening

- Tenant scoping enforced; use header `x-organization-id` or query `organization_id` / `tenant_id`.
- Uses `lean()` with projection and `maxTimeMS`.
- Stable sort: `createdAt desc, _id desc`.
- Pagination envelope for `/api/llm-costs` when `page`/`limit` present.

Quick check (example):
GET /api/llm-costs?organization_id=T0015&page=1&limit=10
Expect: 200, body: `{ "data": [...], "page": 1, "limit": 10, "total": <number>, "hasMore": <boolean> }`
Headers:
- `X-Applied-Tenant: T0015`
- `X-Request-Id: <trace id if present>`
- `X-Route-Timing: <ms>`
