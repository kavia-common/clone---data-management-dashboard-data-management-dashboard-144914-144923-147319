/**
 * Utility functions for encrypting tenant/organization identifiers.
 * Uses crypto-js in the browser to perform AES-128-ECB encryption.
 */
import CryptoJS from 'crypto-js';
// Import from JS config to ensure availability in production build
import { VALIDATED_TENANT_SALT } from '../config/auth';

/**
 * Validate that a salt string looks like a non-placeholder hex value.
 */
function isLikelyValidHexSalt(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  const trimmed = s.trim();
  if (!trimmed) return false;
  // explicitly guard placeholder markers used by QA (keep detection for older placeholders)
  if (trimmed.includes('<QA-specific-salt>') || trimmed.includes('PLACEHOLDER')) return false;
  // must be even-length hex
  if (trimmed.length % 2 !== 0) return false;
  return /^[0-9a-fA-F]+$/.test(trimmed);
}

/**
 * Derive a 16-byte AES key from a hex salt:
 * - Parse hex salt to WordArray
 * - SHA-256 the bytes
 * - Take first 16 bytes (128 bits) as key
 */
function deriveAes128KeyFromSaltHex(saltHex: string): CryptoJS.lib.WordArray {
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
function removeBase64Padding(b64: string): string {
  return b64.replace(/=+$/, '');
}

// PUBLIC_INTERFACE
export function isTenantSaltValid(): boolean {
  /** Returns true if VALIDATED_TENANT_SALT looks like a valid non-placeholder hex string. */
  return isLikelyValidHexSalt(VALIDATED_TENANT_SALT);
}

// PUBLIC_INTERFACE
export function encryptTenantId(tenantId: string): string {
  /** Encrypts a tenant/organization ID using AES-128-ECB with a key derived
   * from VALIDATED_TENANT_SALT (hex). The ciphertext is returned as base64
   * without padding characters.
   *
   * This matches the expected server-side validation scheme:
   * - Key: SHA-256(saltHexBytes) first 16 bytes
   * - Mode: ECB, No IV
   * - Padding: PKCS7 (default in crypto-js)
   * - Output: base64 without '=' padding
   *
   * If the salt is missing/placeholder, this function throws a descriptive error
   * so UI can surface a friendly message instead of crashing the app.
   */
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('tenantId must be a non-empty string');
  }

  if (!isTenantSaltValid()) {
    throw new Error('Tenant encryption salt is not configured for this environment.');
  }

  const key = deriveAes128KeyFromSaltHex(String(VALIDATED_TENANT_SALT).trim());

  // Encrypt with AES-ECB, no IV. crypto-js expects WordArray for key, and mode/padding options.
  const encrypted = CryptoJS.AES.encrypt(tenantId, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });

  const b64 = encrypted.toString(); // base64 with padding
  return removeBase64Padding(b64);
}
