import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  getStoredAuth,
  persistAuth,
  loginApi,
  registerApi,
  getApiClient,
} from "../api/client";

const AuthContext = createContext(null);

// PUBLIC_INTERFACE
export function useAuth() {
  /** Hook to access the AuthContext with { user, token, login, register, logout, loading, error }. */
  return useContext(AuthContext);
}

// PUBLIC_INTERFACE
export function AuthProvider({ children }) {
  /** Provides auth state and actions to descendants. */
  const [user, setUser] = useState(null);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Initialize from storage
  useEffect(() => {
    const { token: storedToken, user: storedUser } = getStoredAuth();
    if (storedToken) setToken(storedToken);
    if (storedUser) setUser(storedUser);
    setLoading(false);
  }, []);

  // Handle 401 signal from axios interceptor
  useEffect(() => {
    const api = getApiClient();
    const interceptor = api.interceptors.response.use(
      (res) => res,
      (err) => {
        if (err?.isAuthError) {
          // clear session and bubble up
          logout();
        }
        return Promise.reject(err);
      }
    );
    return () => api.interceptors.response.eject(interceptor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PUBLIC_INTERFACE
  async function login({ email, password }) {
    /** Performs login and persists the token and user. */
    setError("");
    try {
      const data = await loginApi({ email, password });
      if (data?.token) {
        persistAuth(data.token, data.user || null);
        setToken(data.token);
        setUser(data.user || null);
      } else {
        setError("Invalid login response");
      }
      return data;
    } catch (e) {
      setError(e?.response?.data?.message || "Login failed");
      throw e;
    }
  }

  // PUBLIC_INTERFACE
  async function register({ name, email, password }) {
    /** Performs registration and persists the token and user. */
    setError("");
    try {
      const data = await registerApi({ name, email, password, emailRedirectTo: process.env.REACT_APP_SITE_URL });
      if (data?.token) {
        persistAuth(data.token, data.user || null);
        setToken(data.token);
        setUser(data.user || null);
      } else {
        setError("Invalid registration response");
      }
      return data;
    } catch (e) {
      setError(e?.response?.data?.message || "Registration failed");
      throw e;
    }
  }

  // PUBLIC_INTERFACE
  function logout() {
    /** Clears current session information. */
    persistAuth("", null);
    setToken("");
    setUser(null);
  }

  const value = useMemo(
    () => ({ user, token, login, register, logout, loading, error }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, token, loading, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// PUBLIC_INTERFACE
export function Protected({ children, fallback = null }) {
  /** Renders children only if authenticated, otherwise renders fallback. */
  const { token, loading } = useAuth();
  if (loading) return fallback || <div className="screen-center">Loading...</div>;
  if (!token) return fallback || <div className="screen-center">Please login</div>;
  return children;
}
