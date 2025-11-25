'use strict';

/**
 * PUBLIC_INTERFACE
 * getTenantSaltConfig
 * Returns flags about static salt configuration without exposing the value.
 */
function getTenantSaltConfig() {
  const salt = process.env.SECRET_SALT || process.env.AUTH_TENANT_SALT || process.env.PASSWORD_SALT || '';
  const isMissing = !salt || String(salt).trim() === '';
  const isPlaceholder =
    !!salt &&
    ['changeme', 'placeholder', 'secret', 'password', 'default'].some((w) =>
      String(salt).toLowerCase().includes(w)
    );

  const urlSafeBase64Like = /^[A-Za-z0-9\-_]+$/.test(String(salt)) && !String(salt).includes('=');
  const looksValid = !isMissing && urlSafeBase64Like && String(salt).length >= 16;

  return { isMissing, isPlaceholder, looksValid, salt };
}

/**
 * PUBLIC_INTERFACE
 * getTenantConfig
 * Strategy to resolve and allow tenants.
 */
function getTenantConfig() {
  const defaultTenant = process.env.AUTH_DEFAULT_TENANT || 'DEMO';
  const allowed = new Set(
    String(process.env.ALLOWED_TENANTS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );

  const strategy = 'explicit|header|auth|default';

  // PUBLIC_INTERFACE
  function resolveTenant(req, organizationId) {
    if (organizationId && typeof organizationId === 'string' && organizationId.trim() !== '') {
      return organizationId.trim();
    }
    const headerTid = req?.headers?.['x-tenant-id'] || req?.headers?.['x-tenant'];
    if (headerTid && typeof headerTid === 'string' && headerTid.trim() !== '') {
      return String(headerTid).trim();
    }
    if (req?.auth?.tenantId && typeof req.auth.tenantId === 'string') {
      return String(req.auth.tenantId).trim();
    }
    return defaultTenant;
  }

  // PUBLIC_INTERFACE
  function isTenantAllowed(tenantId) {
    if (!tenantId || typeof tenantId !== 'string') return false;
    if (allowed.size === 0) {
      return true;
    }
    return allowed.has(tenantId);
  }

  return { resolveTenant, isTenantAllowed, strategy, defaultTenant };
}

/**
 * PUBLIC_INTERFACE
 * getJwtConfig
 * Provides JWT config from environment.
 */
function getJwtConfig() {
  return {
    secret: process.env.JWT_SECRET || process.env.JWT_HS256_SECRET || '',
    issuer: process.env.JWT_issuer || process.env.JWT_ISSUER || 'local-issuer',
    audience: process.env.JWT_AUDIENCE || 'local-audience',
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    algorithm: process.env.JWT_ALG || 'HS256',
  };
}

const authConfig = {
  getTenantSaltConfig,
  getTenantConfig,
  getJwtConfig,
};

module.exports = { ...authConfig, default: authConfig };
