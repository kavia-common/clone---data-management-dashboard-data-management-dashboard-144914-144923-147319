import { useEffect, useRef } from "react";
import { quickUsersResolutionSmoke } from "../api/verifyUsersRoute";

/**
 * PUBLIC_INTERFACE
 * useVerifyUsersUrlOnce
 * React hook: in development, logs a one-time verification that /api/users resolves
 * to .../api/users?organization_id=T0015 using the shared client conventions.
 * No network calls. Safe in production (no-op).
 */
export function useVerifyUsersUrlOnce() {
  const doneRef = useRef(false);
  useEffect(() => {
    if (doneRef.current) return;
    if (process.env.NODE_ENV !== "production") {
      try {
        const url = quickUsersResolutionSmoke();
        // eslint-disable-next-line no-console
        console.log("[Verify Hook] Resolved /api/users URL:", url);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[Verify Hook] Verification failed:", e);
      }
    }
    doneRef.current = true;
  }, []);
}
