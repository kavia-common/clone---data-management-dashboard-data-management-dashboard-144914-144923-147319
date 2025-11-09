import { API_BASE_URL } from "../config/auth";
import { decryptTenantId, encryptTenantId } from "../utils/hash";
import { resolveAuthEndpointUrl } from "./urlOverrides";

/**
* Fetch organizations for a given email
*/
export async function fetchUserOrganizationsByEmail(email) {
  const relativePath = `/api/auth/user-organizations?email=${encodeURIComponent(email)}`;
  const url = resolveAuthEndpointUrl(relativePath, API_BASE_URL);

  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "omit",
  });

  if (res.ok) {
    const data = await res.json().catch(() => ({}));
    return data && typeof data === "object"
      ? data
      : { email, organizations: [] };
  }

  if (res.status === 404) {
    return { email, organizations: [] };
  }

  const text = await res.text().catch(() => "");
  const err = new Error(`Failed to fetch organizations: ${res.status} ${text}`);
  err.status = res.status;
  throw err;
}

/**
* 🔐 Login with provided organization ID (already selected by user)
*/
export async function loginWithOrgEmailPassword({ organizationId, email, password }) {
  if (!organizationId) throw new Error("organizationId is required");
  if (!email) throw new Error("email is required");
  if (!password) throw new Error("password is required");

  // ✅ Encrypt organization ID before sending
  const encryptedOrgId = encryptTenantId(organizationId);

  console.log("🔐 Organization ID (Encrypted):", encryptedOrgId);
  console.log("🔓 Organization ID (Decrypted Check):", decryptTenantId(encryptedOrgId));

  // Build login payload
  const body = {
    organization_id: encryptedOrgId,
    email,
    password,
  };

  const url = resolveAuthEndpointUrl(`/api/auth/login`, API_BASE_URL);

  if (process.env.NODE_ENV !== "production") {
    console.log("🟢 Login payload preview", {
      organization_id: encryptedOrgId,
      email,
      password: "[REDACTED]",
    });
  }

  // Send login request
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain",
    },
    body: JSON.stringify(body),
    credentials: "omit",
  });

  const contentType = res.headers.get("content-type") || "";
  let payload;
  if (contentType.includes("application/json")) {
    payload = await res.json().catch(() => ({}));
  } else {
    payload = await res.text().catch(() => "");
  }

  if (!res.ok) {
    const baseMsg =
      typeof payload === "string"
        ? payload
        : payload?.message ||
          (payload?.detail && Array.isArray(payload.detail)
            ? payload.detail.map((d) => d.msg).join(", ")
            : null) ||
          `Login failed (${res.status})`;

    const msg =
      res.status === 500
        ? `${baseMsg}. The server reported an internal error.`
        : baseMsg;

    const err = new Error(msg);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }

  let token = null;
  if (typeof payload === "string") {
    token = payload;
  } else if (payload && (payload.token || payload.access_token)) {
    token = payload.token || payload.access_token;
  }

  return { token, payload };
}
 