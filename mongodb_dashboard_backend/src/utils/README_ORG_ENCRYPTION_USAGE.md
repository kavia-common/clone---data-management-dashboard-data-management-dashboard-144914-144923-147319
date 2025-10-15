To consume the encrypted organization ID within backend modules, import and call:

const { getEncryptedOrganizationId } = require('../utils/organizationEncryption');

const encryptedOrgId = getEncryptedOrganizationId();
// Use encryptedOrgId where needed (e.g., matching tokens, headers, or downstream services)
// Do not store or hardcode ciphertext; always compute at runtime.
