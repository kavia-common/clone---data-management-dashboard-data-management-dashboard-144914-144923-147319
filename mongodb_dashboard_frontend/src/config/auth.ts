export const FASTAPI_BASE_URL = 'https://kaviaqa-worktool.cloud.kavia.ai';
/**
 * PUBLIC_INTERFACE
 * Validated tenant salt: use the same value as frontend JS config resolves.
 * Source of truth is REACT_APP_SECRET_SALT with a dev default; TS side should mirror JS export.
 */
declare const process: any;
const ENV_SALT =
  (typeof process !== 'undefined' &&
    process?.env &&
    String(process.env.REACT_APP_SECRET_SALT || '').trim()) || '';
const DEFAULT_SECRET_SALT = 'g5StFHvCyj0Hf9g8j87nGA';

function normalizeBase64Url(s: string) {
  return String(s || '')
    .trim()
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export const VALIDATED_TENANT_SALT = normalizeBase64Url(ENV_SALT || DEFAULT_SECRET_SALT);
