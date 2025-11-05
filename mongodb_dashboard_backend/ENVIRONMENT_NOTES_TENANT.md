# Multi-tenant Enforcement Configuration

Set one of the following for JWT verification:
- JWT_PUBLIC_KEY: PEM-encoded RSA public key (recommended for RS256/RS512)
- JWT_SECRET: Shared secret for HS256/HS512 (for demos only)

Optional claims mapping (all supported automatically):
- Tenant: custom:tenant_id OR tenant_id OR tenantId
- User ID: sub OR user_id OR userId
- Roles: roles (array or comma string) OR cognito:groups

Frontend will send Authorization: Bearer <AccessToken> obtained from /api/auth/login.
Backend derives tenant_id from token. Client must not send tenant_id in params/body for scoping; it will be ignored or enforced server-side.
