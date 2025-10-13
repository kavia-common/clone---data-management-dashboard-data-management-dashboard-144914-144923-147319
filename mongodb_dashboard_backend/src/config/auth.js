'use strict';

/**
 * PUBLIC_INTERFACE
 * Auth configuration helper.
 * Reads authentication-related secrets/salts from environment variables and provides
 * safe accessors and validation helpers without crashing the server when missing.
 *
 * Environment variables considered:
 * - AUTH_JWT_SECRET: Secret used for signing JWTs (if/when JWT is implemented).
 * - AUTH_PASSWORD_SALT: Salt used for hashing passwords (if backend performs hashing).
 * - AUTH_TENANT_SALT: Salt used for encrypting/validating tenant/organization identifiers.
 *
 * Notes:
 * - In development, these can be set to dummy values, but production should use strong secrets.
 * - This module does not throw; it returns state that callers can use to respond with 4xx errors.
 */

const PLACEHOLDER_VALUES = new Set(['', 'changeme', 'placeholder', 'qa_salt', 'qa-placeholder', 'demo']);

function normalize(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

/**
 * PUBLIC_INTERFACE
 * Returns the configured tenant/organization salt and validation flags.
 */
function getTenantSaltConfig() {
  const salt =
    normalize(process.env.AUTH_TENANT_SALT) ||
    normalize(process.env.QA_SALT) || // support legacy env var names if any
    normalize(process.env.PASSWORD_SALT); // last-resort legacy

  const isMissing = salt.length === 0;
  const isPlaceholder = PLACEHOLDER_VALUES.has(salt.toLowerCase()) || salt.length < 12;
  return { salt, isMissing, isPlaceholder };
}

/**
 * PUBLIC_INTERFACE
 * Returns the configured JWT secret and validation flags.
 */
function getJwtSecretConfig() {
  const secret = normalize(process.env.AUTH_JWT_SECRET) || normalize(process.env.JWT_SECRET);
  const isMissing = secret.length === 0;
  const isWeak = secret.length > 0 && secret.length < 16;
  return { secret, isMissing, isWeak };
}

/**
 * PUBLIC_INTERFACE
 * Returns the configured password hashing salt (if used) and flags.
 */
function getPasswordSaltConfig() {
  const salt = normalize(process.env.AUTH_PASSWORD_SALT) || normalize(process.env.PASSWORD_SALT);
  const isMissing = salt.length === 0;
  const isPlaceholder = PLACEHOLDER_VALUES.has(salt.toLowerCase()) || salt.length < 12;
  return { salt, isMissing, isPlaceholder };
}

module.exports = {
  getTenantSaltConfig,
  getJwtSecretConfig,
  getPasswordSaltConfig,
};
