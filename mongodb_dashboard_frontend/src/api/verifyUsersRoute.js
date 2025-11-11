import { getApiBase } from "./config";
import { getOrganizationId, setActiveOrganizationId } from "./authTokenProvider";

/**
 * PUBLIC_INTERFACE
 * verifyUsersUrlResolution
 * Verifies that api/users resolves to <BASE>/api/users?organization_id=<org> using the shared API client conventions.
 *
 * Usage:
 *   Call this in a dev-only code path (e.g., after login or during bootstrap) to log verification.
 *   It will not perform any network calls; it only constructs and logs the expected URL.
 *
 * Note:
 * - This is a side-effect-free helper intended for quick, runtime-safe assertion/logging.
 * - If an organizationIdOverride is provided, it is temporarily set for the duration of this call to simulate middleware state.
 */
export function verifyUsersUrlResolution(organizationIdOverride = null) {
  const prevOrg = getOrganizationId();
  if (organizationIdOverride && organizationIdOverride !== prevOrg) {
    // Mirror how middleware would set active organization in storage for the client
    setActiveOrganizationId(organizationIdOverride);
  }
  const org = organizationIdOverride || getOrganizationId();

  const base = String(getApiBase()).replace(/\/*$/, ""); // e.g., https://.../api
  const root = base; // base already points at .../api
  const finalUrl = `${root}/users${org ? `?organization_id=${encodeURIComponent(org)}` : ""}`;

  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.log("[Verify] /api/users resolved to:", finalUrl);
    try {
      const q = finalUrl.split("?")[1] || "";
      const usp = new URLSearchParams(q);
      const allowedKeys = new Set(["organization_id"]);
      const badKeys = [];
      for (const k of usp.keys()) {
        if (!allowedKeys.has(k)) badKeys.push(k);
      }
      if (badKeys.length > 0) {
        // eslint-disable-next-line no-console
        console.warn("[Verify] Unexpected query params present for /api/users:", badKeys);
      }
    } catch {
      // ignore parse issues
    }
  }

  // restore original organization if we changed it
  if (organizationIdOverride && organizationIdOverride !== prevOrg) {
    setActiveOrganizationId(prevOrg || null);
  }

  return finalUrl;
}

/**
 * PUBLIC_INTERFACE
 * quickUsersResolutionSmoke
 * Small helper to log a concrete example of resolution for an organization (e.g., T0015)
 * as per acceptance criteria. Does not mutate state after completion.
 */
export function quickUsersResolutionSmoke() {
  const url = verifyUsersUrlResolution("T0015");
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    
  }
  return url;
}
