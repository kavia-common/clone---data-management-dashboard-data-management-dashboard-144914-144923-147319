/**
 * Utility functions for encrypting tenant/organization identifiers.
 * Uses crypto-js in the browser to perform AES-128-ECB encryption.
 */
import CryptoJS from 'crypto-js';
import { getValidatedTenantSalt, tryGetTenantSalt } from '../config/auth';

/**
 * Validate that the salt appears URL-safe base64 without padding, length ~22-24.
 */
function isUrlSafeShortBase64(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  const v = s.trim();
  if (!v) return false;
  if (!/^[A-Za-z0-9\-_]+$/.test(v)) return false;
  if (v.includes('=')) return false;
  if (v.length < 20 || v.length > 44) return false;
  return true;
}

/**
 * Derive a 16-byte AES key from a hex salt:
 * - Parse hex salt to WordArray
 * - SHA-256 the bytes
 * - Take first 16 bytes (128 bits) as key
 */
function deriveAes128KeyFromBase64UrlSalt(saltB64Url: string): CryptoJS.lib.WordArray {
  // Convert base64url -> base64 and pad, decode to bytes
  const b64 = saltB64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (b64.length % 4)) % 4;
  const b64p = b64 + '='.repeat(padLen);
  const byteStr = typeof atob === 'function' ? atob(b64p) : Buffer.from(b64p, 'base64').toString('binary');
  const bytes = [];
  for (let i = 0; i < byteStr.length; i++) bytes.push(byteStr.charCodeAt(i));
  const saltWA = CryptoJS.lib.WordArray.create(bytes as any, bytes.length);
  const hash = CryptoJS.SHA256(saltWA);
  const words = hash.words.slice(0, 4); // 16 bytes
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
  /** Returns true if VALIDATED_TENANT_SALT looks valid (URL-safe base64url without padding). */
  const val = tryGetTenantSalt();
  return isUrlSafeShortBase64(val as unknown as string);
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

  const salt = getValidatedTenantSalt();
  const key = deriveAes128KeyFromBase64UrlSalt(String(salt).trim());
>>>>>>> REPLACE   
```

````edit file="/home/kavia/workspace/code-generation/data-management-dashboard-144914-144924/mongodb_dashboard_frontend/src/utils/crypto.ts"      
<<<<<<< SEARCH
  const key = deriveAes128KeyFromBase64UrlSalt(String(VALIDATED_TENANT_SALT).trim());
=======
  const salt = getValidatedTenantSalt();
  const key = deriveAes128KeyFromBase64UrlSalt(String(salt).trim());

  // Encrypt with AES-ECB, no IV. crypto-js expects WordArray for key, and mode/padding options.
  const encrypted = CryptoJS.AES.encrypt(tenantId, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });

  const b64 = encrypted.toString(); // base64 with padding
  return removeBase64Padding(b64);
}

/** PUBLIC_INTERFACE
 * Decrypts an encrypted tenant ID (base64 without padding) using the configured salt.
 */
export function decryptTenantId(enc: string): string {
  if (!enc || typeof enc !== 'string') throw new Error('enc must be a non-empty string');
  if (!isTenantSaltValid()) throw new Error('Tenant encryption salt is not configured for this environment.');
  const key = deriveAes128KeyFromBase64UrlSalt(String(VALIDATED_TENANT_SALT).trim());
  const padLen = (4 - (enc.length % 4)) % 4;
  const padded = enc + '='.repeat(padLen);
  const decrypted = CryptoJS.AES.decrypt({ ciphertext: CryptoJS.enc.Base64.parse(padded) } as any, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });
  return CryptoJS.enc.Utf8.stringify(decrypted);
}
