import { API_BASE_URL } from "../config/auth";
import { isTenantSaltValid } from "../utils/crypto"; // removed generateOrganizationId since we won’t use it
import { resolveAuthEndpointUrl } from "./urlOverrides";

// ✅ Static organization ID
const STATIC_ORGANIZATION_ID = "g5StFHvCyj0Hf9g8j87nGA";

// PUBLIC_INTERFACE
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

// PUBLIC_INTERFACE
export async function loginWithOrgEmailPassword({ email, password }) {
  if (!email) throw new Error("email is required");
  if (!password) throw new Error("password is required");

  if (!isTenantSaltValid()) {
    const err = new Error(
      "Login cannot proceed: tenant secret salt is not configured."
    );
    err.code = "SALT_NOT_CONFIGURED";
    throw err;
  }

  // ✅ Use static organization ID instead of dynamic
  const organization_id = STATIC_ORGANIZATION_ID;

  const url = resolveAuthEndpointUrl(`/api/auth/login`, API_BASE_URL);
  const body = { organization_id, email, password };

  if (process.env.NODE_ENV !== "production") {
    console.log("Auth payload preview", {
      organization_id,
      email,
      password: "[REDACTED]",
    });
  }

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
        ? `${baseMsg}. The server reported an internal error. If you are using a placeholder QA salt, please configure a valid salt.`
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
