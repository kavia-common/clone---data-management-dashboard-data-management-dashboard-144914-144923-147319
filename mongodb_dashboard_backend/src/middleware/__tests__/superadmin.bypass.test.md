# Super Admin Bypass - Minimal Manual Test Notes

Purpose: Confirm that when a Super Admin (role includes "Super Admin" or tenant_id T0000) calls APIs, tenant scoping is bypassed.

How to test (manual quick check):
- Issue a request with Authorization: Bearer <valid token> that has roles: ["Super Admin"] and tenant_id: "T0000".
- Call GET /api/users with no x-organization-id header.
- Expected:
  - Response includes header X-All-Tenants: true and X-Tenant-Bypass: true.
  - Data is not filtered by any tenant_id.
- Call GET /api/session-tracking without tenant params.
  - Expect 200, and X-All-Tenants: true, X-Tenant-Bypass: true.
- Call GET /api/dashboard/overview/metrics (if available wiring passes req) should reflect totals across all tenants.

Regression check (non-admin):
- With a normal tenant-bound user, ensure 403 when attempting to switch tenant via headers conflicting with JWT.
- Ensure responses include X-Applied-Tenant header with tenant id, and X-Tenant-Bypass: false.
