# Project Create Summary Endpoint Quick Verification

Purpose: Confirm that `/api/project-create/summary` responds deterministically with a 200 JSON payload and includes `user_name` resolved from Users when `user_id` is provided (AppDeployment lookup removed).

Manual test steps:
1) Basic wiring/ping
   - GET /api/project-create/__ping
   - Expect: 200, `{ ok: true, route: "project-create", ... }`

2) Summary without tenant
   - GET /api/project-create/summary
   - Expect: 200, `{ success: true, buckets: [] }` (no hang, no cancel)

3) Summary with tenant and optional project
   - GET /api/project-create/summary?tenant_id=T0000
   - Expect: 200, JSON with `success` and `buckets` array (may be empty if no data)

4) Top-level user_name resolution
   - GET /api/project-create/summary?user_id=<USER_ID>&tenant_id=T0000
   - Expect: 200, top-level fields `user_id` and `user_name` present.
   - Note: user_name is resolved from `users` collection trying fields:
     name | displayName | display_name | full_name | fullName | username | user_name | email.

5) Dev verify helper
   - GET /api/dev/verify/project-create/summary?project_id=<id>&tenant_id=T0000
   - Optional header: x-organization-id: T0000
   - Expect: 200, `{ ok: boolean, note, received }` without hang; route sets header `x-verify-route`.

Diagnostics headers:
- x-project-create-ms: total handler time
- x-project-create-tenant: when tenant is provided
- x-project-id: when project_id is provided
