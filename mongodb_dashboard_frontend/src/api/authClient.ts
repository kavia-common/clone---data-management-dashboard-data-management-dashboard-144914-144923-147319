import { resolveAuthEndpointUrl } from './urlOverrides';
import { isTenantSaltValid } from '../utils/crypto';

// Keep a fallback base for other auth endpoints (login etc.)
const LOCAL_AUTH_BASE =
  (typeof process !== 'undefined' && process.env && (process.env as any).REACT_APP_API_BASE_URL) ||
  (() => {
    try {
      const u = new URL(window.location.href);
      return `${u.protocol}//${u.hostname}:7001`;
    } catch {
      return 'http://localhost:7001';
    }
  })();

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
  const relativePath = `/api/auth/user-organizations?email=${encodeURIComponent(email)}`;
  const url = resolveAuthEndpointUrl(relativePath, LOCAL_AUTH_BASE);
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    credentials: 'include',
  });

  if (!res.ok) {
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
    return [];
  } catch (e) {
    throw new Error('Invalid response from organizations endpoint');
  }
}

// PUBLIC_INTERFACE
export async function login(payload: LoginPayload): Promise<any> {
  if (!isTenantSaltValid()) {
    throw new Error('Login cannot proceed: QA tenant encryption salt is not configured.');
  }

  const url = resolveAuthEndpointUrl(`/api/auth/login`, LOCAL_AUTH_BASE);
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let message = `Login failed (${res.status})`;
    try {
      const data = await res.json();
      message = data?.message || data?.detail || (typeof data === 'string' ? data : message);
      if (res.status === 500) {
        message = `${message}. If you are using a placeholder QA salt, please configure a valid salt.`;
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  try {
    return await res.json();
  } catch {
    const txt = await res.text();
    return txt;
  }
}
