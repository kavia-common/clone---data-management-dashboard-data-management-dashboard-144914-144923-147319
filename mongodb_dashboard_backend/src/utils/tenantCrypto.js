'use strict';

/**
 * PUBLIC_INTERFACE
 * Tenant encryption helpers for backend parity. These functions derive a key from SECRET_SALT
 * and provide round-trip encrypt/decrypt using AES-128-ECB with base64 (unpadded) output.
 *
 * Note: For production-grade security, prefer authenticated encryption and avoid ECB.
 * This exists only to match the existing frontend-compatible scheme.
 */
const crypto = require('crypto');
const { getTenantSaltConfig } = require('../config/auth');

/**
 * Derive a 16-byte key from the url-safe base64 salt by decoding salt and hashing.
 */
function deriveKeyFromSalt() {
  const { salt, isMissing, isPlaceholder, looksValid } = getTenantSaltConfig();
  if (isMissing || isPlaceholder || !looksValid) {
    throw new Error('SECRET_SALT is missing or invalid.');
  }
  // Convert base64url to base64 for decode
  const b64 = salt.replace(/-/g, '+').replace(/_/g, '/');
  const buf = Buffer.from(b64, 'base64');
  const hash = crypto.createHash('sha256').update(buf).digest(); // 32 bytes
  return hash.subarray(0, 16); // 128-bit key
}

/**
 * PUBLIC_INTERFACE
 * Encrypts a tenant id and returns base64 (without '=') string.
 */
function encryptTenantId(tenantId) {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('tenantId must be a non-empty string');
    }
  const key = deriveKeyFromSalt();
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
  cipher.setAutoPadding(true);
  const enc1 = cipher.update(Buffer.from(tenantId, 'utf8'));
  const enc2 = cipher.final();
  const b64 = Buffer.concat([enc1, enc2]).toString('base64').replace(/=+$/g, '');
  return b64;
}

/**
 * PUBLIC_INTERFACE
 * Decrypts an encrypted tenant id (base64, without '=') and returns plaintext.
 */
function decryptTenantId(encTenantId) {
  if (!encTenantId || typeof encTenantId !== 'string') {
    throw new Error('encTenantId must be a non-empty string');
  }
  const key = deriveKeyFromSalt();
  // restore padding if removed
  const padLen = (4 - (encTenantId.length % 4)) % 4;
  const b64 = encTenantId + '='.repeat(padLen);
  const data = Buffer.from(b64, 'base64');
  const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
  decipher.setAutoPadding(true);
  const dec1 = decipher.update(data);
  const dec2 = decipher.final();
  return Buffer.concat([dec1, dec2]).toString('utf8');
}

module.exports = {
  encryptTenantId,
  decryptTenantId,
};
