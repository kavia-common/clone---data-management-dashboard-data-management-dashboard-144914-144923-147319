import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getStoredAuth, isAuthenticated as isAuthed, saveAuthSession, clearAuthSession } from '../config/auth';
import { setActiveTenant, getActiveTenant, clearActiveTenant } from '../utils/tenantClient';

const AuthContext = createContext({
  isAuthenticated: false,
  token: null,
  tenantId: null,
  // PUBLIC_INTERFACE
  login: (token, opts) => {},
  // PUBLIC_INTERFACE
  logout: () => {},
  // PUBLIC_INTERFACE
  getTenantId: () => null,
});

/**
 * PUBLIC_INTERFACE
 * AuthProvider
 * Context provider to expose authentication state and the authenticated tenant id.
 * It persists token via config/auth storage and mirrors tenant_id into localStorage
 * using utils/tenantClient.setActiveTenant. Admins are still restricted to this tenant
 * until a future multi-tenant switching feature is implemented.
 */
export function AuthProvider({ children }) {
  /** Context provider to expose authentication state based on localStorage. */
  const [auth, setAuth] = useState(() => getStoredAuth());
  const [tenantId, setTenantId] = useState(() => getActiveTenant());

  useEffect(() => {
    // Sync with localStorage changes (e.g., other tabs)
    function onStorage(e) {
      if (e.key === 'auth') {
        try {
          setAuth(e.newValue ? JSON.parse(e.newValue) : null);
        } catch {
          setAuth(null);
        }
      }
      if (e.key === 'activeTenant' || e.key === 'activeTenantId') {
        // keep in sync with external changes
        try {
          setTenantId(getActiveTenant());
        } catch {
          setTenantId(null);
        }
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo(() => {
    return {
      isAuthenticated: isAuthed(),
      token: auth?.token || null,
      tenantId: tenantId || null,
      // PUBLIC_INTERFACE
      login: (token, opts = {}) => {
        /**
         * Accepts token and optional opts. If opts.tenant_id is provided (preferred),
         * we mirror it to the local tenant store.
         */
        const extra = {};
        if (opts?.tenant_id) extra.tenant_id = String(opts.tenant_id);
        saveAuthSession(token || null, extra);
        if (opts?.tenant_id) {
          setActiveTenant(String(opts.tenant_id));
          setTenantId(String(opts.tenant_id));
        } else if (!getActiveTenant()) {
          // Ensure a value exists; otherwise leave null until server session bootstrap
          setTenantId(null);
        }
        setAuth(getStoredAuth());
      },
      // PUBLIC_INTERFACE
      logout: () => {
        clearAuthSession();
        clearActiveTenant();
        setTenantId(null);
        setAuth(null);
      },
      // PUBLIC_INTERFACE
      getTenantId: () => tenantId || getActiveTenant(),
    };
  }, [auth, tenantId]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// PUBLIC_INTERFACE
export function useAuth() {
  /** Hook to access auth context */
  return useContext(AuthContext);
}
