# Organization/Tenant ID Encryption (Runtime Helper)

This backend computes the encrypted organization ID at runtime from environment variables using AES-128-ECB, with key = SHA-256(salt)[0..15] and base64 output without padding.

## Environment variables

- ORGANIZATION_ID: The plaintext organization/tenant ID to encrypt at runtime. Required by getEncryptedOrganizationId().
- TENANT_SALT: Server-side salt used to derive the AES key. Preferred and required for encryption.
- NEXT_PUBLIC_TENANT_SALT: Legacy/public variable. Accepted as fallback for compatibility but not recommended server-side.
- INTERNAL_ENCRYPTION_ROUTE_TOKEN: Optional header token to enable the verification route in production.

See .env.example for placeholders.

## Programmatic usage

Use the helper to get the encrypted org ID without storing static ciphertext:

```js
// PUBLIC_INTERFACE
// Example usage inside backend code
const { getEncryptedOrganizationId, encryptOrgId } = require('./src/utils/organizationEncryption');

// Gets encrypted value for process.env.ORGANIZATION_ID using TENANT_SALT
const encFromEnv = getEncryptedOrganizationId();

// Or encrypt an explicit plaintext with an explicit salt
const ciphertext = encryptOrgId('your-plaintext-org-id', process.env.TENANT_SALT);
```

The helper matches the same AES-128-ECB scheme used elsewhere in the backend (src/utils/crypto/encryption.js) for parity.

## Optional verification endpoint

For quick verification, an internal route is available:

- Path: GET /internal/encrypted-org-id
- Returns: { encryptedOrgId }

Safety behavior:
- In non-production (NODE_ENV !== 'production'): Enabled by default.
- In production: Requires header x-internal-token with value INTERNAL_ENCRYPTION_ROUTE_TOKEN. If not set or mismatch, returns 403.

Example curl (non-production):
```bash
curl http://localhost:3001/internal/encrypted-org-id
```

Example curl (production):
```bash
curl -H "x-internal-token: $INTERNAL_ENCRYPTION_ROUTE_TOKEN" https://your-host/internal/encrypted-org-id
```

## Notes

- No static encrypted value is stored in code; it is computed at runtime from env.
- Keep TENANT_SALT secret and never expose it to the client.
- The output is base64 without padding, consistent with the existing reference.
