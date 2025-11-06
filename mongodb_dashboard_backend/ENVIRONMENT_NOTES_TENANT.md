# Multi-tenant Enforcement Configuration

Set one of the following for JWT verification:
- JWT_PUBLIC_KEY: PEM-encoded RSA public key (recommended for RS256/RS512)
- JWT_SECRET: Shared secret for HS256/HS512 (for demos only)

Optional issuer/audience checks:
- COGNITO_ISSUER or JWT_ISSUER: expected issuer (optional)
- COGNITO_AUDIENCE or JWT_AUDIENCE: expected audience (optional)

Supported claims mapping (auto-detected):
- Tenant: custom:tenant_id OR tenant_id OR tenantId OR organization_id
- User ID: sub OR user_id OR userId
- Roles: roles (array or comma string) OR cognito:groups

Behavior:
- Backend extracts tenantId from token and enforces tenant_id on all DB queries and aggregations.
- Any route with :tenantId requires it to match req.auth.tenantId unless roles include admin|superadmin|tenant:read:all.
- Requests missing Authorization or missing a tenant claim will result in 401/403.

For development:
- Set JWT_SECRET to a non-empty value (e.g., "dev-secret") to enable HS256 fallback.

```
# .env.example (excerpt)
JWT_SECRET=change_me_dev_only
# Optional
COGNITO_ISSUER=
COGNITO_AUDIENCE=
JWT_ISSUER=
JWT_AUDIENCE=
```
