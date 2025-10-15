const crypto = require('crypto');

/**
 * Encryption utilities for tenant/organization IDs.
 * Uses AES-128-ECB with a key derived from SHA-256(salt)[0..15] and Base64 output without padding.
 * Falls back to environment variable TENANT_SALT (preferred) or NEXT_PUBLIC_TENANT_SALT for backward compatibility.
 *
 * Note: Keep salts secret and do not expose in client-side code.
 */

// Prefer server-only env var; fall back to old public var for compatibility
const DEFAULT_SALT = process.env.TENANT_SALT || process.env.NEXT_PUBLIC_TENANT_SALT;

/**
 * Derive a 16-byte AES key from the given salt using SHA-256 and taking the first 16 bytes.
 * @param {string} salt
 * @returns {Buffer}
 */
function deriveKey(salt) {
  return crypto.createHash('sha256').update(String(salt)).digest().slice(0, 16);
}

/**
 * Ensure a usable salt, preferring provided, else env.
 * Throws a clear error if no salt is available.
 * @param {string|undefined} provided
 * @returns {string}
 */
function resolveSalt(provided) {
  const salt = provided || DEFAULT_SALT;
  if (!salt) {
    throw new Error('TENANT_SALT is not defined. Provide a salt argument or set TENANT_SALT in your environment.');
  }
  return String(salt);
}

// PUBLIC_INTERFACE
function encrypt(data, salt) {
  /** Encrypt arbitrary data string using AES-128-ECB and return base64 without padding. */
  const usableSalt = resolveSalt(salt);
  const key = deriveKey(usableSalt);
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
  const encrypted = Buffer.concat([cipher.update(String(data), 'utf8'), cipher.final()]);
  return encrypted.toString('base64').replace(/=+$/, '');
}

// PUBLIC_INTERFACE
function decrypt(data, salt) {
  /** Decrypt base64 (no padding) ciphertext using AES-128-ECB and return utf8 string. */
  const usableSalt = resolveSalt(salt);
  const key = deriveKey(usableSalt);
  const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
  const decrypted = Buffer.concat([decipher.update(Buffer.from(String(data), 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

// PUBLIC_INTERFACE
function encryptTenantId(tenantId, salt) {
  /** Convenience wrapper for encrypting a tenant/organization ID using the standard scheme. */
  return encrypt(tenantId, salt);
}

// PUBLIC_INTERFACE
function decryptTenantId(encrypted, salt) {
  /** Convenience wrapper for decrypting a tenant/organization ID. Returns null on failure. */
  try {
    if (!encrypted) throw new Error('Encrypted tenant ID is required');
    return decrypt(encrypted, salt);
  } catch (_err) {
    return null;
  }
}

module.exports = {
  encrypt,
  decrypt,
  encryptTenantId,
  decryptTenantId,
};
