# Project Create Summary Strict Filter Verification

This change enforces strict filtering for `/api/project-create/summary`:
- created_at in UTC between [start_dateT00:00:00.000Z, end_dateT23:59:59.999Z]
- exact match on tenant_id and (optional) project_id
- no broadened `$or` across timestamp fields or `$in` usage
- response replaces project_id with user_id in the buckets and top-level echo

Dev verify:
- GET `/api/dev/verify/project-create/exact?tenant_id=b2c&project_id=166223&date=2025-10-08`
  - Executes `countDocuments` with the exact filter and asserts `actualCount === 1`.

Tests:
- `src/routes/__tests__/projectCreate.summary.strict.test.js` seeds data and asserts verify route count=1 and summary returns single item with `user_id` present.

Diagnostics:
- Response headers:
  - `x-project-create-tenant`, `x-project-id`, `x-project-create-from`, `x-project-create-to`, timing.
