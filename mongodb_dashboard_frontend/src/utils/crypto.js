import CryptoJS from 'crypto-js';
import { VALIDATED_TENANT_SALT } from '../config/auth';

/**
 * Derive a 16-byte AES key from a hex salt:
 * - Parse hex salt to WordArray
 * - SHA-256 the bytes
 * - Take first 16 bytes (128 bits) as key
 */
function deriveAes128KeyFromSaltHex(saltHex) {
  const saltBytes = CryptoJS.enc.Hex.parse(saltHex);
  const hash = CryptoJS.SHA256(saltBytes);
  const words = hash.words.slice(0, 4); // 4 * 32 bits = 128 bits
  return CryptoJS.lib.WordArray.create(words, 16);
}

function stripBase64Padding(b64) {
  return b64.replace(/=+$/g, '');
}

// PUBLIC_INTERFACE
export function encryptTenantId(tenantId) {
  /** Encrypts the provided tenant/organization id using AES-128-ECB with a key derived from VALIDATED_TENANT_SALT (hex),
   *  returning base64 without padding.
   *
   * Algorithm:
   * - Key: SHA-256(saltHexBytes) first 16 bytes -> 128-bit key
   * - Mode: ECB
   * - Padding: Pkcs7
   * - Output: Base64 string with trailing '=' padding removed
   */
  if (!tenantId) {
    throw new Error('tenantId is required for encryption');
  }
  const key = deriveAes128KeyFromSaltHex(VALIDATED_TENANT_SALT);
  const encrypted = CryptoJS.AES.encrypt(tenantId, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });
  return stripBase64Padding(encrypted.toString());
}

// PUBLIC_INTERFACE
export function setTenantEncryptionSalt() {
  /** No-op retained for API parity. The encryption salt is fixed by VALIDATED_TENANT_SALT. */
  console.warn('setTenantEncryptionSalt is deprecated; VALIDATED_TENANT_SALT is used instead.');
  return true;
}
