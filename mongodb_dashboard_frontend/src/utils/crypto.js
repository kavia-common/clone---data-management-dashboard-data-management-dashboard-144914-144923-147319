import CryptoJS from 'crypto-js';
import { getValidatedTenantSalt, tryGetTenantSalt } from '../config/auth';

/**
 * Validate that the salt appears URL-safe base64 without padding, length ~22-24.
 */
function isUrlSafeShortBase64(s) {
  if (typeof s !== 'string') return false;
  const v = s.trim();
  if (!v) return false;
  if (!/^[A-Za-z0-9\-_]+$/.test(v)) return false;
  if (v.includes('=')) return false;
  if (v.length < 20 || v.length > 44) return false;
  return true;
}

function stripBase64Padding(b64) {
  return b64.replace(/=+$/g, '');
}

function toWordArray(buf) {
  // Convert Uint8Array/Buffer to CryptoJS WordArray
  const words = [];
  let i;
  for (i = 0; i < buf.length; i += 4) {
    words.push(
      ((buf[i] || 0) << 24) |
        ((buf[i + 1] || 0) << 16) |
        ((buf[i + 2] || 0) << 8) |
        ((buf[i + 3] || 0) << 0),
    );
  }
  return CryptoJS.lib.WordArray.create(words, buf.length);
}

/**
 * Derive AES-128 key from base64url salt: decode, sha256, take first 16 bytes
 */
function deriveAes128KeyFromBase64UrlSalt(saltB64Url) {
  const b64 = saltB64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (b64.length % 4)) % 4;
  const b64p = b64 + '='.repeat(padLen);
  const byteStr = typeof atob === 'function' ? atob(b64p) : Buffer.from(b64p, 'base64').toString('binary');
  const bytes = new Uint8Array(byteStr.length);
  for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
  const saltWA = toWordArray(bytes);
  const hash = CryptoJS.SHA256(saltWA);
  const words = hash.words.slice(0, 4);
  return CryptoJS.lib.WordArray.create(words, 16);
}

// PUBLIC_INTERFACE
export function isTenantSaltValid() {
  /** Returns true if configured tenant salt looks valid (URL-safe base64 without padding). */
  const val = tryGetTenantSalt();
  return isUrlSafeShortBase64(val);
}

// PUBLIC_INTERFACE
export function encryptTenantId(tenantId) {
  /** Encrypt tenant/organization id using AES-128-ECB with key derived from base64url salt; returns base64 without '='. */
  if (!tenantId) {
    throw new Error('tenantId is required for encryption');
  }
  if (!isTenantSaltValid()) {
    throw new Error('Tenant encryption salt is not configured for this environment.');
  }
  const salt = getValidatedTenantSalt();
  const key = deriveAes128KeyFromBase64UrlSalt(String(salt).trim());
  const encrypted = CryptoJS.AES.encrypt(tenantId, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });
  return stripBase64Padding(encrypted.toString());
}

// PUBLIC_INTERFACE
export function decryptTenantId(enc) {
  /** Decrypts a base64 (unpadded) ciphertext to plaintext using the same scheme; useful for testing. */
  if (!enc) throw new Error('enc is required for decryption');
  if (!isTenantSaltValid()) throw new Error('Tenant encryption salt is not configured for this environment.');
  const key = deriveAes128KeyFromBase64UrlSalt(String(VALIDATED_TENANT_SALT).trim());
  // Re-add padding for base64 decode inside crypto-js
  const padLen = (4 - (enc.length % 4)) % 4;
  const padded = enc + '='.repeat(padLen);
  const decrypted = CryptoJS.AES.decrypt({ ciphertext: CryptoJS.enc.Base64.parse(padded) }, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });
  return CryptoJS.enc.Utf8.stringify(decrypted);
}

// PUBLIC_INTERFACE
export function setTenantEncryptionSalt() {
  /** No-op retained for API parity. The encryption salt is fixed by VALIDATED_TENANT_SALT. */
  console.warn('setTenantEncryptionSalt is deprecated; VALIDATED_TENANT_SALT is used instead.');
  return true;
}
