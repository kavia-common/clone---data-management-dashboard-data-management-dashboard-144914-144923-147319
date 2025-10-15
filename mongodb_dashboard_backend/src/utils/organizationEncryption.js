'use strict';

/**
 * PUBLIC_INTERFACE
 * getEncryptedOrganizationId and encryptOrgId helpers.
 *
 * Encrypts a plaintext ORGANIZATION_ID from the environment using AES-128-ECB
 * with a 16-byte key derived from SHA-256(salt)[0..15]. Output is base64 without padding.
 *
 * Salt resolution order: TENANT_SALT (preferred), then NEXT_PUBLIC_TENANT_SALT (legacy fallback).
 *
 * Note:
 * - This mirrors the existing encryption scheme used in src/utils/crypto/encryption.js to keep parity.
 * - Do not store static ciphertexts in code; compute at runtime from env.
 */

const crypto = require('crypto');

function deriveKeyFromSalt(salt) {
  // Derive 16-byte key from SHA-256(salt)
  return crypto.createHash('sha256').update(String(salt)).digest().slice(0, 16);
}

function resolveSalt() {
  const salt = process.env.TENANT_SALT || process.env.NEXT_PUBLIC_TENANT_SALT;
  if (!salt) {
    throw new Error(
      'TENANT_SALT is not defined. For backward compatibility, NEXT_PUBLIC_TENANT_SALT may be used, but server-side usage is discouraged.'
    );
  }
  return salt;
}

/**
 * PUBLIC_INTERFACE
 * encryptOrgId
 * Encrypts the provided plaintext orgId using the given salt (or env salt if not provided)
 * with AES-128-ECB and returns base64 string without padding.
 * @param {string} orgId - plaintext organization id
 * @param {string|undefined} salt - optional salt; if omitted, resolve from env
 * @returns {string} encrypted base64 (unpadded)
 */
function encryptOrgId(orgId, salt) {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('encryptOrgId: orgId must be a non-empty string');
  }
  const usableSalt = salt ?? resolveSalt();
  const key = deriveKeyFromSalt(usableSalt);
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
  const enc = Buffer.concat([cipher.update(orgId, 'utf8'), cipher.final()]);
  return enc.toString('base64').replace(/=+$/, '');
}

/**
 * PUBLIC_INTERFACE
 * getEncryptedOrganizationId
 * Reads ORGANIZATION_ID from environment and returns its encrypted form using encryptOrgId.
 * @returns {string} encrypted base64 (unpadded)
 */
function getEncryptedOrganizationId() {
  const orgId = process.env.ORGANIZATION_ID;
  if (!orgId) {
    throw new Error(
      'ORGANIZATION_ID is not set. Please define ORGANIZATION_ID in the environment to use getEncryptedOrganizationId().'
    );
  }
  return encryptOrgId(orgId);
}

module.exports = {
  encryptOrgId,
  getEncryptedOrganizationId,
};
