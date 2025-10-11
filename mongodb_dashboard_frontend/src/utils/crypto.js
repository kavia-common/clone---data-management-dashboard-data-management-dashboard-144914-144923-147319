/**
 * Utility functions for encrypting tenant/organization identifiers.
 * Uses crypto-js in the browser to perform AES-128-ECB encryption.
 */
import * as CryptoJS from 'crypto-js';
import { VALIDATED_TENANT_SALT } from '../config/auth';

/**
 * Derive a 16-byte AES key from a hex salt:
 * - Parse hex salt to WordArray
 * - SHA-256 the bytes
 * - Take first 16 bytes (128 bits) as key
 */
function deriveAes128KeyFromSaltHex(saltHex) {
  // Parse salt hex to bytes
  const saltBytes = CryptoJS.enc.Hex.parse(saltHex);
  // Hash with SHA-256
  const hash = CryptoJS.SHA256(saltBytes);
  // Take first 16 bytes (128 bits). WordArray supports clamp via creating a new WordArray.
  const words = hash.words.slice(0, 4); // 4 words * 32 bits = 128 bits
  return CryptoJS.lib.WordArray.create(words, 16);
}

/**
 * Remove base64 padding '=' characters.
 */
function removeBase64Padding(b64) {
  return b64.replace(/=+$/, '');
}

// PUBLIC_INTERFACE
export function encryptTenantId(tenantId) {
  /** Encrypts a tenant/organization ID using AES-128-ECB with a key derived
   * from VALIDATED_TENANT_SALT (hex). The ciphertext is returned as base64
   * without padding characters.
   *
   * This matches the expected server-side validation scheme:
   * - Key: SHA-256(saltHexBytes) first 16 bytes
   * - Mode: ECB, No IV
   * - Padding: PKCS7 (default in crypto-js)
   * - Output: base64 without '=' padding
   */
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('tenantId must be a non-empty string');
    }

  const key = deriveAes128KeyFromSaltHex(VALIDATED_TENANT_SALT);

  // Encrypt with AES-ECB, no IV. crypto-js expects WordArray for key, and mode/padding options.
  const encrypted = CryptoJS.AES.encrypt(tenantId, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });

  const b64 = encrypted.toString(); // base64 with padding
  return removeBase64Padding(b64);
}
