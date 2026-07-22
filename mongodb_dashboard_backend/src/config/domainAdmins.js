'use strict';

/**
 * PUBLIC_INTERFACE
 * domainAdmins
 *
 * Hardcoded registry of "domain admin" tenants for the Organization feature.
 * A domain admin tenant is granted a cross-tenant view (multi-tenant dropdown) scoped
 * to every organization document sharing the same `domain` value in the `organizations`
 * collection.
 *
 * Example: T0038 ("TATA ELXSI LIMITED", domain "tataelxsi.co.in") can view/select any of
 * the ~28 tenants that share the tataelxsi.co.in domain, while none of those other
 * tenants (even though they share the same domain) get this cross-tenant capability.
 *
 * To add a new domain admin in the future, add one entry below - no schema/DB migration
 * required. Keys are tenant_id (case-insensitive), values are the managed email domain.
 */
const DOMAIN_ADMIN_TENANTS = Object.freeze({
  T0038: 'tataelxsi.co.in',
});

// PUBLIC_INTERFACE
function getManagedDomain(tenantId) {
  /** Returns the managed domain string for a tenant_id if it is a registered domain admin, else null. */
  const key = String(tenantId || '').trim().toUpperCase();
  if (!key) return null;
  return DOMAIN_ADMIN_TENANTS[key] || null;
}

// PUBLIC_INTERFACE
function isDomainAdminTenant(tenantId) {
  /** Boolean convenience wrapper around getManagedDomain. */
  return !!getManagedDomain(tenantId);
}

module.exports = {
  DOMAIN_ADMIN_TENANTS,
  getManagedDomain,
  isDomainAdminTenant,
};
