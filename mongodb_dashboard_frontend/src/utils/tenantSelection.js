/**
 * PUBLIC_INTERFACE
 * getTenantId utility
 * Resolves current tenant from the shared tenantClient helper.
 * Avoids importing DataContext (no getActiveTenantId is exported there).
 */
export function getTenantId() {
  try {
    // dynamic require to avoid circular deps if any
    // eslint-disable-next-line global-require
    const { getTenantId: getFromClient } = require('./tenantClient');
    if (typeof getFromClient === 'function') {
      return getFromClient();
    }
  } catch (e) {
    // ignore and fall through
  }
  return null;
}
