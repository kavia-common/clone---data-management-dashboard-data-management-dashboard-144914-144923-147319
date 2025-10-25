export const FASTAPI_BASE_URL = 'https://kaviaqa-worktool.cloud.kavia.ai';
/**
 * PUBLIC_INTERFACE
 * Validated tenant salt: use the same value as frontend JS config resolves.
 * Source of truth is REACT_APP_SECRET_SALT only (no defaults). This module validates the env and throws
 * helpful errors when missing/invalid to prevent insecure fallbacks.
 */
declare const process: any;

const ENV_SALT: string =
  (typeof process !== 'undefined' &&
    (process as any)?.env &&
    String((process as any).env.REACT_APP_SECRET_SALT || '').trim()) || '';

function normalizeBase64Url(s: string) {
  return String(s || '')
    .trim()
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/**
 * Validate env-provided salt strictly:
 * - Must be non-empty
 * - After normalization, must be >= 16 characters
 * - Must be URL-safe base64 charset only
 */
function validateSaltOrThrow(raw: string): string {
  const normalized = normalizeBase64Url(raw);
  if (!normalized) {
    throw new Error(
      'REACT_APP_SECRET_SALT is required but was not provided. Please set it in your environment (e.g., .env) before building/running the app.'
    );
  }
  if (normalized.length < 16) {
    throw new Error(
      'REACT_APP_SECRET_SALT is too short after normalization. Provide a sufficiently random URL-safe string (>=16 chars).'
    );
  }
  if (!/^[A-Za-z0-9\-_]+$/.test(normalized)) {
    throw new Error(
      'REACT_APP_SECRET_SALT contains invalid characters. Use only URL-safe base64 characters (A-Z, a-z, 0-9, -, _).'
    );
  }
  return normalized;
}

/** PUBLIC_INTERFACE
 * Returns the validated tenant salt or throws if missing/invalid.
 */
export function getValidatedTenantSalt(): string {
  return validateSaltOrThrow(ENV_SALT);
}

/** PUBLIC_INTERFACE
 * Returns the normalized tenant salt or null if invalid/missing.
 */
export function tryGetTenantSalt(): string | null {
  try {
    return validateSaltOrThrow(ENV_SALT);
  } catch {
    return null;
  }
}

// PUBLIC_INTERFACE
export const VALIDATED_TENANT_SALT: string | undefined = undefined; // deprecated to avoid import-time eval
