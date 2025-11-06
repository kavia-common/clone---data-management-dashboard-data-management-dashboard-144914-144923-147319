//
// PUBLIC_INTERFACE
// Wrapper helpers to include Authorization header from login storage.
// Use: import { apiGet, apiPost } from './client.tenant'
//
function getAccessToken() {
  try {
    return localStorage.getItem('AccessToken');
  } catch {
    return null;
  }
}

function authHeaders() {
  const t = getAccessToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// PUBLIC_INTERFACE
export async function apiGet(path, options = {}) {
  const base = process.env.REACT_APP_API_BASE_URL || '';
  const res = await fetch(`${base}${path}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {}),
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status}`);
  }
  return res.json();
}

// PUBLIC_INTERFACE
export async function apiPost(path, body, options = {}) {
  const base = process.env.REACT_APP_API_BASE_URL || '';
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {}),
    },
    body: JSON.stringify(body || {}),
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`POST ${path} failed: ${res.status}`);
  }
  return res.json();
}
