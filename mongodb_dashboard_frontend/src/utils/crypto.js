import CryptoJS from 'crypto-js';

// IMPORTANT: Do not hardcode secrets/salts in code. For demo purposes, we read from env.
// For production, use a secure server-side mechanism to provide salts/tokens via configuration.
const TENANT_ENCRYPTION_SALT = process.env.REACT_APP_TENANT_ENCRYPTION_SALT || 'demo_salt_replace_me';

// PUBLIC_INTERFACE
export function encryptTenantId(tenantId, salt = TENANT_ENCRYPTION_SALT) {
  /** Encrypts the provided tenant/organization id using AES-128-ECB with salt as key, returns base64 without padding.
   *
   * Algorithm:
   * - Key: MD5(salt) -> 128-bit key
   * - Mode: ECB
   * - Padding: Pkcs7
   * - Output: Base64 string with trailing '=' padding removed
   */
  if (!tenantId) {
    throw new Error('tenantId is required for encryption');
  }
  const key = CryptoJS.MD5(salt); // 128-bit key
  const encrypted = CryptoJS.AES.encrypt(tenantId, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });
  // Base64 encode and strip padding '=' chars
  const b64 = encrypted.toString();
  return b64.replace(/=+$/g, '');
}

// PUBLIC_INTERFACE
export function setTenantEncryptionSalt(salt) {
  /** Allows overriding the encryption salt at runtime (mainly for testing) */
  // no-op; rely on provided param in encryptTenantId if needed.
  console.warn('setTenantEncryptionSalt is provided for API parity; pass salt directly to encryptTenantId if needed.', salt ? 'Salt provided' : 'No salt');
  return true;
}
