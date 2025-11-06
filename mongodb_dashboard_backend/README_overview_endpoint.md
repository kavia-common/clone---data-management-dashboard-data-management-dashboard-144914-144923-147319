# Overview Endpoint

Provides totals for dashboard.

Verification:
- Use GET /api/me with Authorization: Bearer <token> to confirm middleware extracts tenant_id and sub.
- Token claims supported for tenant: `custom:tenant_id`, `tenant_id`, `tenantId`, `organization_id`.

Security and tenant enforcement:
- All protected endpoints require Authorization: Bearer <token>.
- Tenant is extracted from JWT claims (custom:tenant_id or tenant_id, with fallbacks) and enforced across queries and aggregations.
- Any :tenantId param must match req.auth.tenantId unless admin role is present.
