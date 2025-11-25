import { useEffect, useRef } from "react";
import { quickUsersResolutionSmoke } from "../api/verifyUsersRoute";

/**
 * PUBLIC_INTERFACE
 * useVerifyUsersUrlOnce
 * React hook: in development, logs a one-time verification that /api/users resolves
 * to a properly scoped URL using the shared client conventions (no network calls).
 * Safe in production (no-op).
 */
export function useVerifyUsersUrlOnce() {
  const doneRef = useRef(false);
  useEffect(() => {
    if (doneRef.current) return;
    if (process.env.NODE_ENV !== "production" && process.env.REACT_APP_API_DEBUG === '1') {
      try {
        const url = quickUsersResolutionSmoke();
        // eslint-disable-next-line no-console
        console.debug("[Verify Hook] Resolved /api/users URL:", url);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.debug("[Verify Hook] Verification failed:", e);
      }
    }
    doneRef.current = true;
  }, []);
}
