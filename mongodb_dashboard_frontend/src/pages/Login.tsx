import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { fetchUserOrganizationsByEmail, loginWithOrgEmailPassword } from '../api/authClient';
import '../styles/theme.css';

/**
 * PUBLIC_INTERFACE
 * TypeScript Login page aligned with the existing JS login behavior:
 * - Step 1: user enters email and fetches organizations
 * - Step 2: user selects an organization and provides password
 * On successful login:
 * - redirect to prior protected route (from state) if present
 * - otherwise remain consistent with ProtectedRoute-driven navigation (no forced redirect in this component)
 */
type OrganizationItem = {
  id: string;
  name?: string;
  [key: string]: any;
};

type OrgResponse = {
  email: string;
  organizations: OrganizationItem[];
};

const theme = {
  primary: '#2563EB',
  secondary: '#F59E0B',
  background: '#f9fafb',
  surface: '#ffffff',
  text: '#111827',
  error: '#EF4444',
};

const spinner = (
  <span
    style={{
      display: 'inline-block',
      width: 16,
      height: 16,
      border: '2px solid rgba(0,0,0,0.15)',
      borderTopColor: theme.primary,
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
    }}
  />
);

const cardStyle: React.CSSProperties = {
  background: theme.surface,
  borderRadius: 12,
  boxShadow: '0 10px 20px rgba(0,0,0,0.06)',
  padding: 24,
  width: '100%',
  maxWidth: 480,
};

const labelStyle: React.CSSProperties = {
  fontSize: 14,
  color: theme.text,
  marginBottom: 6,
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #e5e7eb',
  outline: 'none',
  fontSize: 14,
  width: '100%',
  background: '#fff',
};

const btnStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 8,
  border: 'none',
  color: '#fff',
  background: theme.primary,
  cursor: 'pointer',
  fontWeight: 600,
};

const secondaryBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: theme.secondary,
};

const errorStyle: React.CSSProperties = {
  color: theme.error,
  fontSize: 13,
  marginTop: 8,
};

export default function Login() {
  const [email, setEmail] = useState('');
  const [orgResponse, setOrgResponse] = useState<OrgResponse | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [password, setPassword] = useState('');
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [loadingLogin, setLoadingLogin] = useState(false);
  const [error, setError] = useState<string>('');

  const location = useLocation();
  const navigate = useNavigate();

  const canFind = useMemo(() => !!email && !loadingOrgs, [email, loadingOrgs]);
  const canLogin = useMemo(
    () => !!email && !!selectedOrgId && !!password && !loadingLogin,
    [email, selectedOrgId, password, loadingLogin]
  );

  async function handleFindOrgs(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email) {
      setError('Please enter an email to look up organizations.');
      return;
    }
    setLoadingOrgs(true);
    try {
      const resp = await fetchUserOrganizationsByEmail(email);
      setOrgResponse(resp as OrgResponse);
      const items = Array.isArray((resp as any)?.organizations) ? (resp as any).organizations : [];
      if (items.length === 0) {
        setSelectedOrgId('');
        setError('No organizations found for this email.');
      } else {
        setSelectedOrgId(items[0]?.id || '');
      }
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'Failed to fetch organizations. Please try again.');
      setOrgResponse(null);
      setSelectedOrgId('');
    } finally {
      setLoadingOrgs(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email || !selectedOrgId || !password) {
      setError('Please provide email, organization and password.');
      return;
    }
    setLoadingLogin(true);
    try {
      await loginWithOrgEmailPassword({
        organizationId: selectedOrgId,
        email,
        password,
      });
      // Redirect to intended path if a protected route sent us here; otherwise rely on app routes
      const from = (location.state as any)?.from?.pathname;
      if (from) {
        navigate(from, { replace: true });
      } // else do nothing; AppRoutes/ProtectedRoute will handle default landing.
    } catch (e: any) {
      console.error('Login error', e);
      const status = e?.status;
      if (status === 401 || status === 403) {
        setError('Invalid credentials. Please check your email, organization, and password.');
      } else if (status === 404) {
        setError('Login endpoint not found or user not found.');
      } else {
        setError(e?.message || 'Login failed. Please try again.');
      }
    } finally {
      setLoadingLogin(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: theme.background,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={cardStyle}>
        <h2 style={{ margin: 0, marginBottom: 12, color: theme.text }}>Welcome back</h2>
        <p style={{ marginTop: 0, marginBottom: 20, color: '#6b7280' }}>
          Sign in to your dashboard using your organization.
        </p>

        <form onSubmit={handleFindOrgs}>
          <div style={{ marginBottom: 14 }}>
            <div style={labelStyle}>Email</div>
            <input
              style={inputStyle}
              type="email"
              required
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {error && !orgResponse && <div style={errorStyle}>{error}</div>}

          <button type="submit" style={btnStyle} disabled={!canFind}>
            {loadingOrgs ? (
              <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                {spinner} Checking organizations...
              </span>
            ) : (
              'Find Organizations'
            )}
          </button>
        </form>

        <div style={{ height: 12 }} />

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 14 }}>
            <div style={labelStyle}>Organization</div>
            <select
              style={inputStyle}
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
            >
              <option value="">Select an organization</option>
              {(orgResponse?.organizations || []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name || o.id}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={labelStyle}>Password</div>
            <input
              style={inputStyle}
              type="password"
              required
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && orgResponse && <div style={errorStyle}>{error}</div>}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="submit"
              style={{ ...btnStyle, flex: 1 }}
              disabled={!canLogin}
            >
              {loadingLogin ? (
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                  {spinner} Signing in...
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
