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
 * - AUTH_DEFAULT_TENANT: Default tenant id/name used when none can be derived.
 * - AUTH_TENANT_STRATEGY: How to resolve tenant (one of: 'body', 'host', 'body-or-host', 'host-or-body'; default 'body-or-host').
 * - AUTH_TENANT_MAPPING: JSON object mapping tenant identifiers to credentials info or a simple allowlist mapping.
 * - AUTH_EXPECTED_TENANTS: Comma-separated list of allowed tenant identifiers (allowlist).
 *
 * Notes:
 * - In development, these can be set to dummy values, but production should use strong secrets.
 * - This module does not throw; it returns state that callers can use to respond with 4xx errors.
 */

const PLACEHOLDER_VALUES = new Set([
  '',
  'changeme',
  'placeholder',
  'qa_salt',
  'qa-placeholder',
  'demo',
  'default',
  'insecure',
]);

function normalize(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}


function isUrlSafeShortBase64(s) {
  if (!s || typeof s !== 'string') return false;
  const v = s.trim();
  if (!v) return false;
  if (PLACEHOLDER_VALUES.has(v.toLowerCase())) return false;
  // 20-32 len guard, expected typically 22-24 for 16 bytes base64url without padding
  if (v.length < 20 || v.length > 44) return false;
  // url-safe chars only
  if (!/^[A-Za-z0-9\-_]+$/.test(v)) return false;
  // no padding '='
  if (v.includes('=')) return false;
  return true;
}

// PUBLIC_INTERFACE
function getTenantSaltConfig() {
  // Single source of truth
  const raw =
    normalize(process.env.SECRET_SALT) ||
    normalize(process.env.AUTH_TENANT_SALT) ||
    normalize(process.env.QA_SALT) ||
    normalize(process.env.PASSWORD_SALT);

  const isMissing = raw.length === 0;
  const isPlaceholder = PLACEHOLDER_VALUES.has(raw.toLowerCase());
  // Normalize: if provided in classic base64 with padding, convert to base64url and strip padding
  let normalized = raw
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  const looksValid = isUrlSafeShortBase64(normalized);

  return {
    // The url-safe short salt to be used across backend
    salt: normalized,
    isMissing,
    isPlaceholder: isPlaceholder || !looksValid,
    looksValid,
  };
}

// PUBLIC_INTERFACE
function getJwtSecretConfig() {
  const secret = normalize(process.env.AUTH_JWT_SECRET) || normalize(process.env.JWT_SECRET);
  const isMissing = secret.length === 0;
  const isWeak = secret.length > 0 && secret.length < 16;
  return { secret, isMissing, isWeak };
}

// PUBLIC_INTERFACE
function getPasswordSaltConfig() {
  const salt = normalize(process.env.AUTH_PASSWORD_SALT) || normalize(process.env.PASSWORD_SALT);
  const isMissing = salt.length === 0;
  const isPlaceholder = PLACEHOLDER_VALUES.has(salt.toLowerCase()) || salt.length < 12;
  return { salt, isMissing, isPlaceholder };
}

/**
 * Extract tenant fragment from a host like subdomain.example.com.
 * If host is kaviaqa-worktool.cloud.kavia.ai we can derive 'qa' or 'kaviaqa-worktool' depending on convention.
 * This implementation returns the left-most label (before first dot).
 */
function tenantFromHost(hostHeader) {
  const host = normalize(hostHeader);
  if (!host) return '';
  const first = host.split('.')[0];
  return first || '';
}

/**
 * PUBLIC_INTERFACE
 * Returns tenant config including resolver and allowlist/mapping checks.
 */
function getTenantConfig() {
  const defaultTenant = normalize(process.env.AUTH_DEFAULT_TENANT) || 'default';
  const strategy = (normalize(process.env.AUTH_TENANT_STRATEGY) || 'body-or-host').toLowerCase();

  // Parse allowlist from CSV
  const expectedCSV = normalize(process.env.AUTH_EXPECTED_TENANTS);
  const allowlist = expectedCSV
    ? expectedCSV
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  // Parse mapping JSON if present
  let mapping = {};
  const mappingRaw = normalize(process.env.AUTH_TENANT_MAPPING);
  if (mappingRaw) {
    try {
      mapping = JSON.parse(mappingRaw);
    } catch (e) {
      // Ignore parse errors; treat as no mapping
      mapping = {};
    }
  }

  // PUBLIC_INTERFACE
  function resolveTenant(req, bodyOrgId) {
    const orgFromBody = normalize(bodyOrgId);
    const orgFromHost = tenantFromHost(req?.headers?.host);

    let resolved = '';
    switch (strategy) {
      case 'body':
        resolved = orgFromBody;
        break;
      case 'host':
        resolved = orgFromHost;
        break;
      case 'host-or-body':
        resolved = orgFromHost || orgFromBody;
        break;
      case 'body-or-host':
      default:
        resolved = orgFromBody || orgFromHost;
        break;
    }

    if (!resolved) {
      resolved = defaultTenant;
    }

    return resolved;
  }

  // PUBLIC_INTERFACE
  function isTenantAllowed(tenantId) {
    const t = normalize(tenantId);
    if (!t) return false;

    // If mapping exists, require presence in mapping
    const mappingKeys = Object.keys(mapping || {});
    if (mappingKeys.length > 0) {
      return mappingKeys.includes(t);
    }

    // Else if allowlist defined, require membership
    if (allowlist.length > 0) {
      return allowlist.includes(t);
    }

    // If neither mapping nor allowlist is configured, allow any non-empty tenant
    return true;
  }

  return {
    defaultTenant,
    strategy,
    allowlist,
    mapping,
    resolveTenant,
    isTenantAllowed,
  };
}

module.exports = {
  getTenantSaltConfig,
  getJwtSecretConfig,
  getPasswordSaltConfig,
  getTenantConfig,
};
