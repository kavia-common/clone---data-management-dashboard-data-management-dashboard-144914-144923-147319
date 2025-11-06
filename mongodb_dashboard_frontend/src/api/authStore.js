//
// PUBLIC_INTERFACE
// Lightweight frontend auth store for tokens and tenant id with safe fallbacks.
//
export function setToken(token) {
  try {
    if (typeof token === 'string' && token) {
      localStorage.setItem('AccessToken', token);
    }
  } catch { /* ignore */ }
}

export function getToken() {
  try {
    return localStorage.getItem('AccessToken') || null;
  } catch {
    return null;
  }
}

export function clearToken() {
  try {
    localStorage.removeItem('AccessToken');
  } catch { /* ignore */ }
}

export function setTenantId(tenantId) {
  try {
    if (typeof tenantId === 'string' && tenantId) {
      localStorage.setItem('tenant_id', tenantId);
    }
  } catch { /* ignore */ }
}

export function getTenantId() {
  try {
    return localStorage.getItem('tenant_id') || null;
  } catch {
    return null;
  }
}

// PUBLIC_INTERFACE
export function authHeaders(extra = {}) {
  const t = getToken();
  const tenant = getTenantId();
  return {
    ...(t ? { Authorization: `Bearer ${t}` } : {}),
    ...(tenant ? { 'x-tenant-id': tenant } : {}),
    ...extra,
  };
}
