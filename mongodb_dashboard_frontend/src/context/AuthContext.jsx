import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

// PUBLIC_INTERFACE
export const AuthContext = createContext(null);

/**
 * PUBLIC_INTERFACE
 * AuthProvider provides authentication state and actions to the app.
 * It stores a token in localStorage and exposes login and logout methods.
 */
export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
    try {
      return localStorage.getItem('auth_token');
    } catch {
      return null;
    }
  });
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem('auth_user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (token) {
        localStorage.setItem('auth_token', token);
      } else {
        localStorage.removeItem('auth_token');
      }
    } catch {
      // ignore persistence errors
    }
  }, [token]);

  useEffect(() => {
    try {
      if (user) {
        localStorage.setItem('auth_user', JSON.stringify(user));
      } else {
        localStorage.removeItem('auth_user');
      }
    } catch {
      // ignore
    }
  }, [user]);

  const login = async ({ organization_id, email, password }, apiClient) => {
    // Calls backend /auth/login and stores token on success
    const res = await apiClient.post('/auth/login', { organization_id, email, password });
    // Backend spec indicates string response placeholder.
    // We will treat any 200 response with data as token; also attach minimal user object.
    const receivedToken = typeof res.data === 'string' ? res.data : res.data?.token || 'ok';
    setToken(receivedToken);
    setUser({ email, organization_id });
    return { token: receivedToken, user: { email, organization_id } };
  };

  const logout = () => {
    setToken(null);
    setUser(null);
  };

  const value = useMemo(() => ({ token, user, isAuthenticated: !!token, login, logout }), [token, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// PUBLIC_INTERFACE
export function useAuth() {
  /** Hook to access auth context. */
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
