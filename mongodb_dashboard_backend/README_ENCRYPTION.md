# Organization/Tenant ID Encryption

This project uses AES-128-ECB with a key derived from SHA-256(salt)[0..15], and base64 output without padding, matching the provided reference.

## Usage from a script

1) Set the salt and run the script:

```bash
TENANT_SALT=your-secret node scripts/encryptOrgId.js --orgId YOUR_ORG_ID
```

Or pass the secret explicitly:

```bash
node scripts/encryptOrgId.js --orgId YOUR_ORG_ID --secret your-secret
```

Output is the encrypted organization/tenant ID.

## Programmatic usage

```js
import { encryptTenantId, decryptTenantId } from 'src/utils/crypto/encryption.js';
const enc = encryptTenantId('acme', 'your-secret');
const dec = decryptTenantId(enc, 'your-secret');
```

Note: Keep this utility on the server-side only to avoid exposing secrets.

## Environment variables

- TENANT_SALT: Server-only default salt used when no secret is provided.
- NEXT_PUBLIC_TENANT_SALT: Legacy/public variable; avoid for server secrets.

## Notes

- Keep salts secret and out of frontend code.
- The output is compatible with the existing reference helpers.
