import { resolveAuthEndpointUrl } from './urlOverrides';

// Keep a fallback base for other auth endpoints (login etc.)
// We intentionally avoid introducing new envs here to satisfy the requirement.
// Prefer window location 3001 backend if available, else default localhost:3001.
const LOCAL_AUTH_BASE =
  (typeof process !== 'undefined' && process.env && (process.env as any).REACT_APP_API_BASE_URL) ||
  (() => {
    try {
      const u = new URL(window.location.href);
      return `${u.protocol}//${u.hostname}:3001`;
    } catch {
      return 'http://localhost:3001';
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

/* PUBLIC_INTERFACE */
export async function getUserOrganizations(email: string): Promise<Organization[]> {
  /** Fetch organizations for a given user email.
   * Special-case: this must call the absolute external domain for user-organizations.
   * We use resolveAuthEndpointUrl to force the absolute URL while retaining local base for others.
   */
  const relativePath = `/api/auth/user-organizations?email=${encodeURIComponent(email)}`;
  const url = resolveAuthEndpointUrl(relativePath, LOCAL_AUTH_BASE);
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
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

/* PUBLIC_INTERFACE */
export async function login(payload: LoginPayload): Promise<any> {
  /** Log in using the existing base URL logic (local/proxied).
   * Do NOT special-case this. Only the user-organizations lookup is forced external.
   */
  const url = `${LOCAL_AUTH_BASE}/api/auth/login`;
  const res = await fetch(url, {
    method: 'POST',
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
      // FastAPI may return { detail: ... } or string
      message = data?.message || data?.detail || (typeof data === 'string' ? data : message);
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  // May be string or object; return as-is
  try {
    return await res.json();
  } catch {
    // if not JSON, attempt text
    const txt = await res.text();
    return txt;
  }
}
