// src/utils/crypto.js
import CryptoJS from "crypto-js";
import { VALIDATED_TENANT_SALT } from "../config/auth";

/**
 * Generate organization_id:
 * - Interpret VALIDATED_TENANT_SALT as HEX bytes (16 bytes expected).
 * - Use those raw bytes directly as AES-128 key (no extra hashing).
 * - AES-128-ECB encrypt the normalized email (trim + toLowerCase()) with PKCS7 padding.
 * - Take ciphertext bytes -> Base64, strip '=' padding, then URL-encode when returning.
 *
 * This matches Python: AES.new(bytes.fromhex(salt), AES.MODE_ECB).encrypt(...)
 */
function hexToWordArray(hex) {
  return CryptoJS.enc.Hex.parse(hex);
}

export function generateOrganizationId(email) {
  if (!email) throw new Error("email required");

  const salt = String(VALIDATED_TENANT_SALT || "").trim();
  if (!/^[0-9a-fA-F]{32}$/.test(salt)) {
    // still attempt but warn
    // eslint-disable-next-line no-console
    console.warn("EXPECTED: VALIDATED_TENANT_SALT to be 32-hex chars (16 bytes). Current:", salt);
  }

  const key = hexToWordArray(salt);

  // Normalize same way backend likely does
  const normalized = String(email).trim().toLowerCase();

  const encrypted = CryptoJS.AES.encrypt(
    CryptoJS.enc.Utf8.parse(normalized),
    key,
    { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
  );

  // ciphertext as Base64 (CryptoJS `ciphertext` -> WordArray)
  const base64 = encrypted.ciphertext.toString(CryptoJS.enc.Base64).replace(/=+$/, "");
  // return raw base64-without-padding (not URL-encoded) or URL-encoded depending on callers.
  // authClient expects URL-encoded organization_id, so we URL-encode here:
  return encodeURIComponent(base64);
}

/**
 * Optional: decrypt (for local debugging)
 */
export function decryptOrganizationId(encUrlEncoded) {
  const salt = String(VALIDATED_TENANT_SALT || "").trim();
  const key = hexToWordArray(salt);
  const enc = decodeURIComponent(String(encUrlEncoded || ""));
  const padded = enc + "=".repeat((4 - (enc.length % 4)) % 4);
  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext: CryptoJS.enc.Base64.parse(padded) },
    key,
    { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
  );
  return CryptoJS.enc.Utf8.stringify(decrypted);
}

export function isTenantSaltValid() {
  return Boolean(VALIDATED_TENANT_SALT && String(VALIDATED_TENANT_SALT).trim().length > 0);
}
