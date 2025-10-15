#!/usr/bin/env node
/*
Usage:
  node scripts/encryptOrgId.js --orgId <ORG_ID> --secret <SECRET_SALT>
  node scripts/encryptOrgId.js --orgId <ORG_ID>            # uses TENANT_SALT from env if --secret not provided
  ORG_ID=acme TENANT_SALT=... node scripts/encryptOrgId.js

Outputs base64 (no padding) ciphertext, compatible with reference code.
*/

const { encryptTenantId } = require('../src/utils/crypto/encryption.js');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--orgId' || a === '--tenantId') args.orgId = argv[++i];
    else if (a === '--secret' || a === '--salt') args.secret = argv[++i];
    else if (a === '-h' || a === '--help') args.help = true;
  }
  return args;
}

(function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('Usage: node scripts/encryptOrgId.js --orgId <ORG_ID> [--secret <SECRET_SALT>]');
    process.exit(0);
  }

  const orgId = args.orgId || process.env.ORG_ID;
  const secret = args.secret || process.env.TENANT_SALT || process.env.NEXT_PUBLIC_TENANT_SALT;

  if (!orgId) {
    console.error('Error: --orgId <ORG_ID> (or ORG_ID env) is required');
    process.exit(1);
  }
  if (!secret) {
    console.error('Error: secret salt is required. Pass --secret or set TENANT_SALT env');
    process.exit(1);
  }

  try {
    const encrypted = encryptTenantId(orgId, secret);
    console.log(encrypted);
  } catch (err) {
    console.error('Encryption failed:', err && err.message ? err.message : String(err));
    process.exit(1);
  }
})();
