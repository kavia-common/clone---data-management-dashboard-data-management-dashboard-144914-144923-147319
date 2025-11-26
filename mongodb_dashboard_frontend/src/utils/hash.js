import CryptoJS from "crypto-js";

// Constants
const TENANT_SALT = '67486f90cb935d7165b796ba397e1c23';
const ROOT_TENANT_ID = process.env.NEXT_PUBLIC_ROOT_TENANT_ID;

if (!TENANT_SALT) {
  throw new Error("TENANT_SALT is not defined or empty");
}

/**
* AES-128-ECB encryption using CryptoJS
* @param {string} data - Text to encrypt
* @param {string} salt - Encryption salt (defaults to TENANT_SALT)
*/
export function encrypt(data, salt = TENANT_SALT) {
  const key = CryptoJS.SHA256(salt).toString(CryptoJS.enc.Hex).slice(0, 32); // 16 bytes = 32 hex chars
  const encrypted = CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(data),
    CryptoJS.enc.Hex.parse(key),
    { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
  );
  return encrypted.ciphertext.toString(CryptoJS.enc.Base64).replace(/=+$/, "");
}

/**
* AES-128-ECB decryption using CryptoJS
* @param {string} data - Base64 string without padding
* @param {string} salt - Decryption salt (defaults to TENANT_SALT)
*/
export function decrypt(data, salt = TENANT_SALT) {
  const key = CryptoJS.SHA256(salt).toString(CryptoJS.enc.Hex).slice(0, 32);
  const padded = data + "=".repeat((4 - (data.length % 4)) % 4); // restore padding
  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext: CryptoJS.enc.Base64.parse(padded) },
    CryptoJS.enc.Hex.parse(key),
    { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
  );
  return CryptoJS.enc.Utf8.stringify(decrypted);
}

/**
* Encrypt a tenant ID
*/
// PUBLIC_INTERFACE
export function encryptTenantId(tenantId) {
  return encrypt(tenantId, TENANT_SALT);
}

/**
* Simple wrapper for encrypting any string
*/
export function encryptString(data) {
  return encrypt(data, TENANT_SALT);
}

/**
* Simple wrapper for decrypting any string
*/
export function decryptString(data) {
  return decrypt(data, TENANT_SALT);
}

/**
* Decrypt a clipboard value gracefully (returns original if fails)
*/
export const decryptStringClipboard = (value) => {
  try {
    return decryptString(value);
  } catch (_error) {
    return value;
  }
};

/**
* Decrypt a tenant ID safely (returns null on failure)
*/
// PUBLIC_INTERFACE
export function decryptTenantId(encrypted) {
  try {
    if (!encrypted) throw new Error("Encrypted tenant ID is required");
    return decrypt(encrypted, TENANT_SALT);
  } catch (_error) {
    return null;
  }
}

/**
* Encrypt the ROOT_TENANT_ID
*/
export function encryptedTenantId() {
  return encryptTenantId(ROOT_TENANT_ID);
}

/**
* Get the static root tenant ID
*/
export function getRootTenantId() {
  return ROOT_TENANT_ID;
}
 