# Auth environment configuration

The backend supports Cognito-compatible JWT verification with JWKS.

Required (for verification mode):
- COGNITO_JWKS_URL: URL to the JWKS endpoint (e.g., https://cognito-idp.<region>.amazonaws.com/<pool_id>/.well-known/jwks.json)
- COGNITO_ISSUER: Optional expected issuer (recommended)
- COGNITO_AUDIENCE: Optional expected audience (recommended)

Optional:
- AUTH_DEFAULT_TENANT: Default tenant id used when a token lacks a custom:tenant_id (dev only)
- ALLOW_DEMO_AUTH: 'true' enables permissive decoding without verification if JWKS is missing (dev only)

Notes:
- In production, configure JWKS to enforce verification. Without JWKS, requests will be rejected with 401.
- The /api/auth/login endpoint issues a local HS256 token only for legacy/demo use; in real deployments, clients should use Cognito tokens.
