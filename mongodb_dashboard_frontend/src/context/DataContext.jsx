import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { listUsers, listSessions } from "../api";

/**
 * PUBLIC_INTERFACE
 * DataContext provides centralized, cached application data for:
 * - users: Users collection
 * - sessions: Session Tracking collection
 * It loads once at app mount and supplies loading/error states and refreshers.
 */

// Shape of the context
const DataContext = createContext({
  users: [],
  usersLoading: false,
  usersError: "",
  sessions: [],
  sessionsLoading: false,
  sessionsError: "",
  refreshUsers: async () => {},
  refreshSessions: async () => {},
});

// PUBLIC_INTERFACE
export function useDataContext() {
  /** Hook to consume the shared DataContext (users/sessions cached data). */
  return useContext(DataContext);
}

// PUBLIC_INTERFACE
export function DataProvider({ children }) {
  /**
   * DataProvider
   * Loads users and sessions ONCE at app mount, caches them, and exposes:
   * - users, usersLoading, usersError, refreshUsers
   * - sessions, sessionsLoading, sessionsError, refreshSessions
   *
   * Design:
   * - Independent loading and error states per collection
   * - Promise-based refreshers for future actions (optional use)
   * - Uses a mount-only guard to avoid duplicate initial loads
   */
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");

  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");

  // Independent refreshers for each dataset
  const refreshUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError("");
    try {
      const res = await listUsers();
      const arr = Array.isArray(res) ? res : res?.items ?? [];
      setUsers(arr);
    } catch (e) {
      setUsers([]);
      setUsersError(e?.response?.data?.message || e?.message || "Failed to load users.");
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError("");
    try {
      const res = await listSessions();
      const arr = Array.isArray(res) ? res : res?.items ?? [];
      setSessions(arr);
    } catch (e) {
      setSessions([]);
      setSessionsError(e?.response?.data?.message || e?.message || "Failed to load sessions.");
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  // Mount-only guard to ensure initial load triggers once
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    // Fire both without awaiting to load in parallel
    refreshUsers();
    refreshSessions();
  }, [refreshUsers, refreshSessions]);

  const value = useMemo(
    () => ({
      users,
      usersLoading,
      usersError,
      sessions,
      sessionsLoading,
      sessionsError,
      refreshUsers,
      refreshSessions,
    }),
    [
      users,
      usersLoading,
      usersError,
      sessions,
      sessionsLoading,
      sessionsError,
      refreshUsers,
      refreshSessions,
    ]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
