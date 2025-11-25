# TODO: Super Admin Bypass Tests

- Verify that when req.user.roles includes "Super Admin":
  - requireTenant sets req.tenantScopeDisabled=true and headers X-Applied-Tenant=all-tenants.
  - tenantScope and tenantScopeEnforcer do not add tenant filters or stamp tenant_id on docs.
  - session.routes POST /api/session/tenant allows any tenantId without membership checks.
- Verify normalization: T000 vs T0000 cases treated equal in comparisons.
