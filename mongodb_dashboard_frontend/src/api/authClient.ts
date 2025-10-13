import { resolveAuthEndpointUrl } from './urlOverrides';

type Organization = {
  id: string;
  name?: string;
  [key: string]: any;
};

type LoginPayload = {
  organization_id: string;
  email: string;
  password: string;
};

// PUBLIC_INTERFACE
export async function getUserOrganizations(email: string): Promise<Organization[]> {
  const LOCAL_AUTH_BASE =
    (typeof process !== 'undefined' && (process as any).env?.REACT_APP_API_BASE_URL) || '';

  const relativePath = `/api/auth/user-organizations?email=${encodeURIComponent(email)}`;
  const url = resolveAuthEndpointUrl(relativePath, LOCAL_AUTH_BASE);
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'omit',
  });

  if (!res.ok) {
    if (res.status === 404) return [];
    let message = `Failed to fetch organizations (${res.status})`;
    try {
      const data = await res.json();
      message = data?.message || data?.detail || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  try {
    const data = await res.json();
    if (Array.isArray(data)) return data;
    if (data?.items && Array.isArray(data.items)) return data.items;
    if (Array.isArray((data as any)?.organizations)) return (data as any).organizations;
  } catch {
    // ignore
  }
  return [];
}

// PUBLIC_INTERFACE
export async function login(payload: LoginPayload): Promise<any> {
  const LOCAL_AUTH_BASE =
    (typeof process !== 'undefined' && (process as any).env?.REACT_APP_API_BASE_URL) || '';
  const url = resolveAuthEndpointUrl(`/api/auth/login`, LOCAL_AUTH_BASE);
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      Accept: 'application/json, text/plain',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const contentType = res.headers.get('content-type') || '';
  let payloadOut: any;
  if (contentType.includes('application/json')) {
    payloadOut = await res.json().catch(() => ({}));
  } else {
    payloadOut = await res.text().catch(() => '');
  }

  if (!res.ok) {
    const baseMsg =
      typeof payloadOut === 'string'
        ? payloadOut
        : payloadOut?.message ||
          (payloadOut?.detail && Array.isArray(payloadOut.detail)
            ? payloadOut.detail.map((d: any) => d.msg).join(', ')
            : null) ||
          `Login failed (${res.status})`;

    const err = new Error(baseMsg);
    // @ts-ignore
    err.status = res.status;
    // @ts-ignore
    err.payload = payloadOut;
    throw err;
  }

  return payloadOut;
}
