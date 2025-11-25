# Super Admin Bypass (tenant_id T0000) - Backend Changes

Purpose: Allow Super Admins to access all tenants' data by bypassing tenant filters when tenant_id is T0000 or user has role "Super Admin".

Key changes:
- middleware/auth.js
  - attachAuthContext now sets user.tenant_id (if present) and user.isSuperAdmin (role includes "Super Admin" or tenant_id matches /^T0+$/).
- middleware/verifyAuth.js
  - Detects Super Admin via roles and T0000 in token claims, sets req.user.isSuperAdmin, and enables bypass flags (req.tenantScopeDisabled, req.allTenants) when appropriate (all_tenants requested or T0000 selected).
- middleware/requireTenant.js (pre-existing logic already handled SA bypass; no additional edits in this step).
- middleware/extractOrganization.js
  - Clarified comment and ensured SA bypass paths set X-All-Tenants header.
- middleware/tenantScope.js
  - Added comment for clarity; SA bypass respected (no filter/stamping).
- controllers/crudFactory.js
  - Added X-Tenant-Bypass response header and debug log to indicate bypass status.
- services/analytics.js
  - getOverviewTotals accepts req and omits tenant filter in SA bypass.
- services/users.service.js
  - getUserProjectsFromSessions accepts req and omits tenant match when SA bypass.
- routes/users.routes.js
  - Passes req into users.service for projects aggregation.
- routes/sessionTracking.routes.js
  - Omits enforcedScope when SA bypass flags present.
- middleware/__tests__/superadmin.bypass.test.md
  - Manual test notes to validate bypass behavior.

Notes:
- Frontend remains unchanged; tenant params are still accepted but ignored when bypass is active.
- Headers added for diagnostics: X-All-Tenants, X-Tenant-Bypass, X-Applied-Tenant, X-Applied-Filter.
