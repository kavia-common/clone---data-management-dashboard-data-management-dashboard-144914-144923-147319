# Project Create Summary Endpoint Quick Verification

Purpose: Confirm that `/api/project-create/summary` responds deterministically with a 200 JSON payload and now displays `user_id` where `project_id` used to be shown. No AppDeployment or user_name lookups are performed.

Manual test steps:
1) Basic wiring/ping
   - GET /api/project-create/__ping
   - Expect: 200, `{ ok: true, route: "project-create", ... }`

2) Summary without tenant
   - GET /api/project-create/summary
   - Expect: 200, `{ success: true, buckets: [] }` (no hang, no cancel)

3) Summary with tenant and optional project (compat)
   - GET /api/project-create/summary?tenant_id=T0000
   - Expect: 200, JSON with `success` and `buckets` array (may be empty if no data)

4) Top-level user_id echo (compat with previous project_id param)
   - GET /api/project-create/summary?project_id=<VALUE>&tenant_id=T0000
   - Expect: 200, top-level field `user_id` equals `<VALUE>`.
   - Buckets should contain objects with `user_id`, `label`, and `count`.

5) Dev verify helper
   - GET /api/dev/verify/project-create/summary?project_id=<id>&tenant_id=T0000
   - Optional header: x-organization-id: T0000
   - Expect: 200, `{ ok: boolean, note, received }` with `ok=true` when `user_id` present.

Diagnostics headers:
- x-project-create-ms: total handler time
- x-project-create-tenant: when tenant is provided
- x-project-id: when project_id param is provided (echoed as header)
