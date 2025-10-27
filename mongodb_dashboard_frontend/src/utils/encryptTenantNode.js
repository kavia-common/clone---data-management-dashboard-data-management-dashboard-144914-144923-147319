// utils/encryptTenantNode.js
import crypto from "crypto";

export function encryptTenantIdNode(tenantId, TENANT_SALT) {
  const key = crypto.createHash("sha256").update(String(TENANT_SALT)).digest().slice(0, 16);
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  const buf = Buffer.concat([cipher.update(String(tenantId), "utf8"), cipher.final()]);
  const b64 = buf.toString("base64").replace(/=+$/, "");
  return encodeURIComponent(b64);
}
