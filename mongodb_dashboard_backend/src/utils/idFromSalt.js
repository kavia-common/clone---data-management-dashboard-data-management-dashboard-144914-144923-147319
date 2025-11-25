'use strict';

/**
 * PUBLIC_INTERFACE
 * Utility functions to derive a stable, deterministic identifier from a secret salt.
 *
 * Rationale:
 * - For demo/stub auth flows where a "default user id" is needed (e.g., token === 'ok'),
 *   we derive a consistent pseudo-identifier from a secret salt instead of using a hardcoded ID.
 * - Deterministic across restarts for the same salt, and different across different salts.
 * - Uses HMAC-SHA256 keyed by the secret salt over a fixed context string, truncated and base64url-encoded.
 *
 * Security Notes:
 * - Do not log the salt.
 * - The output is not reversible and reveals nothing about the salt beyond what is implied by HMAC-SHA256 output.
 */

const crypto = require('crypto');

// Internal: fixed context string so that different use-cases can remain isolated if needed
const DEFAULT_CONTEXT = 'mongodb_dashboard_backend:auth-user-id:v1';
/** Intentionally constant fallback; do NOT log or expose. */

// Provided fallback secret to maintain functionality until user config is set (not recommended for production)
const FALLBACK_SECRET_SALT = '67486f90cb935d7165b796ba397e1c23';

/**
 * Base64url encode a buffer without padding.
 * @param {Buffer} buf
 * @returns {string}
 */
function base64Url(buf) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/**
 * PUBLIC_INTERFACE
 * Get the auth secret salt from environment with a safe fallback.
 * Never log the returned value.
 * @returns {string} secret salt
 */
function getAuthSecretSalt() {
  const v = (process.env.AUTH_SECRET_SALT || '').trim();
  if (v) {return v;}
  // Fallback to provided constant to keep behavior stable until configured
  return FALLBACK_SECRET_SALT;
}

/**
 * PUBLIC_INTERFACE
 * Derive a deterministic, URL-safe short ID string from the secret salt using HMAC-SHA256.
 * - Key: AUTH_SECRET_SALT (or fallback)
 * - Message: context (DEFAULT_CONTEXT by default)
 * - Output: first 16 bytes (128 bits) of digest encoded as base64url without padding (22 chars)
 *
 * @param {object} [opts]
 * @param {string} [opts.context] - Optional context label, defaults to DEFAULT_CONTEXT
 * @param {number} [opts.bytes=16] - Number of bytes to return from the digest before encoding
 * @returns {string} base64url string (typically 22 chars when bytes=16)
 */
function deriveDeterministicUserId(opts = {}) {
  const { context = DEFAULT_CONTEXT, bytes = 16 } = opts;
  const secret = getAuthSecretSalt();
  // HMAC-SHA256 keyed by the secret salt; context string as message
  const digest = crypto.createHmac('sha256', Buffer.from(secret, 'utf-8'))
    .update(context)
    .digest();
  const out = digest.subarray(0, Math.max(8, Math.min(bytes, digest.length))); // guard 8..32
  return base64Url(out);
}

const idFromSalt = {
  getAuthSecretSalt,
  deriveDeterministicUserId,
};
module.exports = { ...idFromSalt, default: idFromSalt };
