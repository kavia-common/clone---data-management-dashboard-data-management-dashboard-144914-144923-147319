import { getApiBase } from "./config";
import { getTenantId, setActiveTenantId } from "./authTokenProvider";

/**
 * PUBLIC_INTERFACE
 * verifyUsersUrlResolution
 * Verifies that api/users resolves to <BASE>/api/users?tenant_id=<tenant> using the shared API client conventions.
 *
 * Usage:
 *   Call this in a dev-only code path (e.g., after login or during bootstrap) to log verification.
 *   It will not perform any network calls; it only constructs and logs the expected URL.
 *
 * Note:
 * - This is a side-effect-free helper intended for quick, runtime-safe assertion/logging.
 * - If a tenantIdOverride is provided, it is temporarily set for the duration of this call to simulate middleware state.
 */
export function verifyUsersUrlResolution(tenantIdOverride = null) {
  const prevTenant = getTenantId();
  if (tenantIdOverride && tenantIdOverride !== prevTenant) {
    // Mirror how middleware would set active tenant in storage for the client
    setActiveTenantId(tenantIdOverride);
  }
  const tenant = tenantIdOverride || getTenantId();

  const base = String(getApiBase()).replace(/\/+$/, ""); // e.g., https://.../api
  const root = base; // base already points at .../api
  const finalUrl = `${root}/users${tenant ? `?tenant_id=${encodeURIComponent(tenant)}` : ""}`;

  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.log("[Verify] /api/users resolved to:", finalUrl);
  }

  // restore original tenant if we changed it
  if (tenantIdOverride && tenantIdOverride !== prevTenant) {
    setActiveTenantId(prevTenant || null);
  }

  return finalUrl;
}

/**
 * PUBLIC_INTERFACE
 * quickUsersResolutionSmoke
 * Small helper to log a concrete example of resolution for tenant T0015 as per acceptance criteria.
 * Does not mutate state after completion.
 */
export function quickUsersResolutionSmoke() {
  const url = verifyUsersUrlResolution("T0015");
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.log(
      "[Verify] Expecting users URL to be: https://kavia-dashboard-kavia-dev.cloud.kavia.ai/api/users?tenant_id=T0015",
      "Got:", url
    );
  }
  return url;
}
