# Overview Endpoint

Provides totals for dashboard.

Verification:
- Use GET /api/me with Authorization: Bearer <token> to confirm middleware extracts tenant_id and sub.
- On login (POST /api/auth/login), store id_token on the client and send it in the Authorization: Bearer header for all protected requests.

Security and tenant enforcement:
- All protected endpoints require Authorization: Bearer <token>.
- Tenant is extracted from JWT claims (custom:tenant_id or tenant_id) and enforced across queries and aggregations.
- Any :tenantId param must match req.auth.tenantId unless admin role is present.
- The backend will ignore any x-tenant-id override when a token is provided; token claims are authoritative.

Public endpoints:
- /api/auth/*, /docs, /api-docs, /openapi.json, /api-docs.json are public and do not require Authorization.

Environment variables (JWT):
- JWT_SECRET or JWT_HS256_SECRET: HMAC secret for HS256 verification (dev/demo).
- JWT_ISSUER or COGNITO_ISSUER: optional issuer check.
- JWT_AUDIENCE or COGNITO_AUDIENCE: optional audience check.
- JWT_EXPIRES_IN: token lifetime for local login issuance (default "1h").
