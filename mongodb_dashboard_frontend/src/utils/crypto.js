// import CryptoJS from 'crypto-js';
// import { VALIDATED_TENANT_SALT } from '../config/auth';

// /**
//  * Validate that the salt appears URL-safe base64 without padding, length ~22-24.
//  */
// function isUrlSafeShortBase64(s) {
//   if (typeof s !== 'string') return false;
//   const v = s.trim();
//   if (!v) return false;
//   if (!/^[A-Za-z0-9\-_]+$/.test(v)) return false;
//   if (v.includes('=')) return false;
//   if (v.length < 20 || v.length > 44) return false;
//   return true;
// }

// function stripBase64Padding(b64) {
//   return b64.replace(/=+$/g, '');
// }

// function toWordArray(buf) {
//   // Convert Uint8Array/Buffer to CryptoJS WordArray
//   const words = [];
//   let i;
//   for (i = 0; i < buf.length; i += 4) {
//     words.push(
//       ((buf[i] || 0) << 24) |
//         ((buf[i + 1] || 0) << 16) |
//         ((buf[i + 2] || 0) << 8) |
//         ((buf[i + 3] || 0) << 0),
//     );
//   }
//   return CryptoJS.lib.WordArray.create(words, buf.length);
// }

// /**
//  * Derive AES-128 key from base64url salt: decode, sha256, take first 16 bytes
//  */
// function deriveAes128KeyFromBase64UrlSalt(saltB64Url) {
//   const b64 = saltB64Url.replace(/-/g, '+').replace(/_/g, '/');
//   const padLen = (4 - (b64.length % 4)) % 4;
//   const b64p = b64 + '='.repeat(padLen);
//   const byteStr = typeof atob === 'function' ? atob(b64p) : Buffer.from(b64p, 'base64').toString('binary');
//   const bytes = new Uint8Array(byteStr.length);
//   for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
//   const saltWA = toWordArray(bytes);
//   const hash = CryptoJS.SHA256(saltWA);
//   const words = hash.words.slice(0, 4);
//   return CryptoJS.lib.WordArray.create(words, 16);
// }

// // PUBLIC_INTERFACE
// export function isTenantSaltValid() {
//   /** Returns true if VALIDATED_TENANT_SALT looks valid (URL-safe base64 without padding). */
//   return isUrlSafeShortBase64(VALIDATED_TENANT_SALT);
// }

// // PUBLIC_INTERFACE
// export function encryptTenantId(tenantId) {
//   /** Encrypt tenant/organization id using AES-128-ECB with key derived from base64url salt; returns base64 without '='. */
//   if (!tenantId) {
//     throw new Error('tenantId is required for encryption');
//   }
//   if (!isTenantSaltValid()) {
//     throw new Error('Tenant encryption salt is not configured for this environment.');
//   }
//   const key = deriveAes128KeyFromBase64UrlSalt(String(VALIDATED_TENANT_SALT).trim());
//   const encrypted = CryptoJS.AES.encrypt(tenantId, key, {
//     mode: CryptoJS.mode.ECB,
//     padding: CryptoJS.pad.Pkcs7,
//   });
//   return stripBase64Padding(encrypted.toString());
// }

// // PUBLIC_INTERFACE
// export function decryptTenantId(enc) {
//   /** Decrypts a base64 (unpadded) ciphertext to plaintext using the same scheme; useful for testing. */
//   if (!enc) throw new Error('enc is required for decryption');
//   if (!isTenantSaltValid()) throw new Error('Tenant encryption salt is not configured for this environment.');
//   const key = deriveAes128KeyFromBase64UrlSalt(String(VALIDATED_TENANT_SALT).trim());
//   // Re-add padding for base64 decode inside crypto-js
//   const padLen = (4 - (enc.length % 4)) % 4;
//   const padded = enc + '='.repeat(padLen);
//   const decrypted = CryptoJS.AES.decrypt({ ciphertext: CryptoJS.enc.Base64.parse(padded) }, key, {
//     mode: CryptoJS.mode.ECB,
//     padding: CryptoJS.pad.Pkcs7,
//   });
//   return CryptoJS.enc.Utf8.stringify(decrypted);
// }

// // PUBLIC_INTERFACE
// export function setTenantEncryptionSalt() {
//   /** No-op retained for API parity. The encryption salt is fixed by VALIDATED_TENANT_SALT. */
//   console.warn('setTenantEncryptionSalt is deprecated; VALIDATED_TENANT_SALT is used instead.');
//   return true;
// }


import CryptoJS from "crypto-js";
import { VALIDATED_TENANT_SALT } from "../config/auth";

/**
 * Detect if salt is hex (e.g. 67486f90cb935d7165b796ba397e1c23)
 */
function isHexSalt(s) {
  return /^[0-9a-fA-F]{32,64}$/.test(s.trim());
}

/**
 * Derive AES-128 key from salt.
 * - If salt is hex → use SHA256 of it, take first 16 bytes.
 * - If salt is base64url → decode then derive similarly.
 */
function deriveAes128Key(salt) {
  if (!salt) throw new Error("Missing salt for key derivation");
  const trimmed = salt.trim();

  let hash;

  if (isHexSalt(trimmed)) {
    const saltWA = CryptoJS.enc.Hex.parse(trimmed);
    hash = CryptoJS.SHA256(saltWA);
  } else {
    // Treat as base64url
    const b64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (b64.length % 4)) % 4;
    const b64p = b64 + "=".repeat(padLen);
    const saltWA = CryptoJS.enc.Base64.parse(b64p);
    hash = CryptoJS.SHA256(saltWA);
  }

  // Take first 16 bytes (128 bits) of hash
  const words = hash.words.slice(0, 4);
  return CryptoJS.lib.WordArray.create(words, 16);
}

/**
 * Encrypt email → organization_id
 */
export function generateOrganizationId(email) {
  if (!email) throw new Error("Email is required to generate organization ID");

  const key = deriveAes128Key(String(VALIDATED_TENANT_SALT).trim());

  // NOTE: no CryptoJS.enc.Utf8.parse needed; CryptoJS handles string inputs itself
  const encrypted = CryptoJS.AES.encrypt(email, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });

  // Use CryptoJS default .toString() (it’s base64)
  return encrypted.toString().replace(/=+$/, "");
}



/**
 * Decrypt organization_id → email (for testing)
 */
export function decryptOrganizationId(enc) {
  const key = deriveAes128Key(String(VALIDATED_TENANT_SALT).trim());
  const padded = enc + "=".repeat((4 - (enc.length % 4)) % 4);
  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext: CryptoJS.enc.Base64.parse(padded) },
    key,
    { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
  );
  return CryptoJS.enc.Utf8.stringify(decrypted);
}

/**
 * Validate tenant salt presence
 */
export function isTenantSaltValid() {
  return Boolean(VALIDATED_TENANT_SALT && VALIDATED_TENANT_SALT.length > 0);
}
