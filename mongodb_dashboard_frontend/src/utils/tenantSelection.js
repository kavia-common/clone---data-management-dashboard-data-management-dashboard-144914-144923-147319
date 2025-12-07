import { getActiveTenantId } from '../context/DataContext' // if available in context; fallback to existing util
// Some parts of the codebase also provide helpers under utils/tenantClient.js; we re-export the common getTenantId.

export function getTenantId() {
  try {
    if (typeof getActiveTenantId === 'function') {
      const id = getActiveTenantId();
      if (id) return id;
    }
  } catch (e) {
    // ignore and fallback
  }
  try {
    // fallback to tenantClient util if available
    // dynamic import to avoid circular deps in some bundlers
    // eslint-disable-next-line global-require
    const { getTenantId: getFromClient } = require('./tenantClient');
    if (typeof getFromClient === 'function') {
      return getFromClient();
    }
  } catch (e) {
    // ignore
  }
  return null;
}
