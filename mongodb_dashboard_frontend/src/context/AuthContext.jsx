import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getStoredAuth, isAuthenticated as isAuthed, saveAuthSession, clearAuthSession } from '../config/auth';
import { getOrganizationId as getActiveOrganization, setActiveOrganizationId as setActiveOrganization, setFromLoginResponse } from '../api/authTokenProvider';

const AuthContext = createContext({
  isAuthenticated: false,
  token: null,
  organizationId: null,
  login: (payload) => {},
  logout: () => {},
  setOrganizationId: (organizationId) => {},
});

// PUBLIC_INTERFACE
export function AuthProvider({ children }) {
  /** Context provider to expose authentication+tenant state based on localStorage. */
  const [auth, setAuth] = useState(() => getStoredAuth());
  const [organizationId, setOrganizationIdState] = useState(() => getActiveOrganization());

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
      if (e.key === 'activeOrganization' || e.key === 'activeTenant') {
        setOrganizationIdState(e.newValue || null);
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo(() => {
    return {
      isAuthenticated: isAuthed(),
      token: auth?.token || null,
      // expose both organizationId and legacy tenantId for consumers
      organizationId: organizationId || getActiveOrganization(),
      tenantId: organizationId || getActiveOrganization(),
      // login now accepts either token string or { token, organization_id, tenant_id }
      login: (loginPayload) => {
        if (loginPayload && typeof loginPayload === 'object') {
          const { token, organization_id, tenant_id } = loginPayload;
          setFromLoginResponse({ token: token || null, organization_id: organization_id || tenant_id || null });
          // keep config/auth in sync for backwards compat
          saveAuthSession(token || null);
          if (organization_id || tenant_id) setActiveOrganization(organization_id || tenant_id);
        } else {
          const token = loginPayload || null;
          setFromLoginResponse({ token, organization_id: null });
          saveAuthSession(token);
        }
        setAuth(getStoredAuth());
        setOrganizationIdState(getActiveOrganization());
      },
      logout: () => {
        clearAuthSession();
        setAuth(null);
        // don't clear organization automatically; it may be session-scoped via backend cookie
      },
      setOrganizationId: (oid) => {
        setActiveOrganization(oid || null);
        setOrganizationIdState(oid || null);
      },
      // legacy setter alias
      setTenantId: (tid) => {
        setActiveOrganization(tid || null);
        setOrganizationIdState(tid || null);
      },
    };
  }, [auth, organizationId]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// PUBLIC_INTERFACE
export function useAuth() {
  /** Hook to access auth context */
  return useContext(AuthContext);
}
