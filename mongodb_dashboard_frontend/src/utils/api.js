//
// PUBLIC_INTERFACE
// apiGet (JS wrapper)
// Wrapper delegating to the TypeScript implementation when available.
// Duplicates the small fetch logic to remain resilient if TS module resolution is not active.
//
function isAbsoluteUrl(url) {
  return /^https?:\/\//i.test(url);
}

function joinUrl(base, path) {
  if (!base) return path;
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  if (!path) return b;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

// PUBLIC_INTERFACE
export async function apiGet(url, options = {}) {
  const base =
    (typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_BASE_URL) || '';
  const finalUrl = isAbsoluteUrl(url)
    ? url
    : url.startsWith('/api')
      ? url
      : joinUrl(base, url);

  const res = await fetch(finalUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
    signal: options.signal,
  });

  let payload = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
  } else {
    try {
      payload = await res.text();
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    const message =
      (payload && typeof payload === 'object' && (payload.message || payload.detail)) ||
      (typeof payload === 'string' ? payload : `Request failed (${res.status})`);
    const err = new Error(message);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }

  return payload;
}

export default { apiGet };
