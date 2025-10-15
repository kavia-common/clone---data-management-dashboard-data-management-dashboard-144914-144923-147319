declare const process: any;

/**
 * PUBLIC_INTERFACE
 * Backend base URL derived from REACT_APP_API_BASE_URL or window origin in browser.
 */
export const FASTAPI_BASE_URL: string =
  (typeof process !== 'undefined' &&
    process?.env &&
    String(process.env.REACT_APP_API_BASE_URL || '').trim().replace(/\/+$/, '')) ||
  (typeof window !== 'undefined' ? `${window.location.origin.replace(/\/+$/, '')}` : '');

/**
 * Normalize to URL-safe base64 without padding.
 */
function normalizeBase64Url(s: string) {
  return String(s || '')
    .trim()
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/**
 * Env-provided salt at build time (preferred).
 */
const ENV_SALT: string =
  (typeof process !== 'undefined' &&
    process?.env &&
    String(process.env.REACT_APP_SECRET_SALT || '').trim()) ||
  '';

let inMemorySalt = '';

/**
 * PUBLIC_INTERFACE
 * Synchronous alias retained for API parity; will be empty string if not provided via env.
 */
export const VALIDATED_TENANT_SALT: string = normalizeBase64Url(ENV_SALT);

/**
 * PUBLIC_INTERFACE
 * Returns a URL-safe, no-padding tenant salt.
 * Priority: REACT_APP_SECRET_SALT -> localStorage cache -> runtime fetch -> ''.
 */
export async function getValidatedTenantSalt(): Promise<string> {
  if (ENV_SALT) return normalizeBase64Url(ENV_SALT);
  if (inMemorySalt) return inMemorySalt;

  // Cache key aligned with JS file
  const SALT_STORAGE_KEY = 'tenant_salt_cached_v1';

  try {
    const cached = localStorage.getItem(SALT_STORAGE_KEY);
    if (cached && typeof cached === 'string') {
      inMemorySalt = normalizeBase64Url(cached);
      if (inMemorySalt) return inMemorySalt;
    }
  } catch {
    // ignore
  }

  const base = FASTAPI_BASE_URL || (typeof window !== 'undefined' ? window.location.origin : '');
  if (base) {
    // Attempt public-safe health first
    try {
      const res = await fetch(`${base.replace(/\/+$/, '')}/api/auth/health`);
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const maybe = (data && (data.encryptedOrgId || data.token || data.orgToken)) || '';
        const resolved = normalizeBase64Url(maybe);
        if (resolved) {
          inMemorySalt = resolved;
          try {
            localStorage.setItem(SALT_STORAGE_KEY, inMemorySalt);
          } catch {}
          return inMemorySalt;
        }
      }
    } catch {}

    // Try optional internal endpoint if available via proxy
    try {
      const r2 = await fetch(`${base.replace(/\/+$/, '')}/internal/encrypted-org-id`);
      if (r2.ok) {
        const d2 = await r2.json().catch(() => null);
        const resolved2 = normalizeBase64Url((d2 && (d2.encryptedOrgId || d2.token)) || '');
        if (resolved2) {
          inMemorySalt = resolved2;
          try {
            localStorage.setItem('tenant_salt_cached_v1', inMemorySalt);
          } catch {}
          return inMemorySalt;
        }
      }
    } catch {}
  }

  console.warn(
    'Tenant salt is not configured. Set REACT_APP_SECRET_SALT or expose a public-safe endpoint returning an encrypted org token.',
  );
  return '';
}
