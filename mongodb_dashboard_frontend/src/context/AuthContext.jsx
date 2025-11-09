import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getStoredAuth, isAuthenticated as isAuthed, saveAuthSession, clearAuthSession } from '../config/auth';
import { getTenantId as getActiveTenant, setActiveTenantId as setActiveTenant, setFromLoginResponse } from '../api/authTokenProvider';

const AuthContext = createContext({
  isAuthenticated: false,
  token: null,
  tenantId: null,
  login: (payload) => {},
  logout: () => {},
  setTenantId: (tenantId) => {},
});

// PUBLIC_INTERFACE
export function AuthProvider({ children }) {
  /** Context provider to expose authentication+tenant state based on localStorage. */
  const [auth, setAuth] = useState(() => getStoredAuth());
  const [tenantId, setTenantIdState] = useState(() => getActiveTenant());

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
      if (e.key === 'activeTenant') {
        setTenantIdState(e.newValue || null);
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo(() => {
    return {
      isAuthenticated: isAuthed(),
      token: auth?.token || null,
      tenantId: tenantId || getActiveTenant(),
      // login now accepts either token string or { token, tenant_id }
      login: (loginPayload) => {
        if (loginPayload && typeof loginPayload === 'object') {
          const { token, tenant_id } = loginPayload;
          setFromLoginResponse({ token: token || null, tenant_id: tenant_id || null });
          // keep config/auth in sync for backwards compat
          saveAuthSession(token || null);
          if (tenant_id) setActiveTenant(tenant_id);
        } else {
          const token = loginPayload || null;
          setFromLoginResponse({ token, tenant_id: null });
          saveAuthSession(token);
        }
        setAuth(getStoredAuth());
        setTenantIdState(getActiveTenant());
      },
      logout: () => {
        clearAuthSession();
        setAuth(null);
        // don't clear tenant automatically; it may be session-scoped via backend cookie
      },
      setTenantId: (tid) => {
        setActiveTenant(tid || null);
        setTenantIdState(tid || null);
      },
    };
  }, [auth, tenantId]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// PUBLIC_INTERFACE
export function useAuth() {
  /** Hook to access auth context */
  return useContext(AuthContext);
}
