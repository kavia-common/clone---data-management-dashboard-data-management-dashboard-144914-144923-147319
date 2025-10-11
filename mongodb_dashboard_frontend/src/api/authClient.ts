import { FASTAPI_BASE_URL } from '../config/auth';

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
  /** Fetch organizations for a given user email from external FastAPI. */
  const url = `${FASTAPI_BASE_URL}/api/auth/user-organizations?email=${encodeURIComponent(email)}`;
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

// PUBLIC_INTERFACE
export async function login(payload: LoginPayload): Promise<any> {
  /** Log in via external FastAPI service using encrypted organization_id. */
  const url = `${FASTAPI_BASE_URL}/api/auth/login`;
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
