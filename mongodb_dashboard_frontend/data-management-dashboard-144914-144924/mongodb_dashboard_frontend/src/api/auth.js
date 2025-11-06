import { apiFetch, setAuthContext } from './client';

// PUBLIC_INTERFACE
export async function login({ organization_id, email, password }) {
  const res = await apiFetch('/api/auth/login', {
    method: 'POST',
    body: { organization_id, email, password },
  });
  const json = await res.json();
  if (res.ok && json && (json.id_token || json.token || json.AccessToken)) {
    const token = json.id_token || json.token || json.AccessToken;
    const tenant_id = json.tenant_id || json.tenantId || organization_id || null;
    setAuthContext({ token, tenant_id });
  }
  return { ok: res.ok, data: json };
}

// PUBLIC_INTERFACE
export async function me() {
  const res = await apiFetch('/api/me');
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, data: json };
}
