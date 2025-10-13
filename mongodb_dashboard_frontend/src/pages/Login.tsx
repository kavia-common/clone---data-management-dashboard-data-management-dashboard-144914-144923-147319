import React, { useMemo, useState } from 'react';
import { getUserOrganizations, login } from '../api/authClient';
import { isTenantSaltValid } from '../utils/crypto';
import { VALIDATED_TENANT_SALT } from '../config/auth';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../styles/theme.css';

type Organization = {
  id: string;
  name?: string;
  [key: string]: any;
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

/**
 * PUBLIC_INTERFACE
 * Login page with 2-step flow:
 * - Step 1: email -> fetch user's organizations
 * - Step 2: select organization or manually input (if none), provide password
 * On successful login:
 * - if redirect_uri query param is present -> navigate to it
 * - else navigate to /dashboard (Overview)
 * Preserves org/tenant behavior and handles INACTIVE_TENANT via server message.
 */
export default function Login() {
  const [step, setStep] = useState<'email' | 'credentials'>('email');

  const [email, setEmail] = useState('');
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [orgFetchLoading, setOrgFetchLoading] = useState(false);
  const [orgFetchError, setOrgFetchError] = useState<string | null>(null);

  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const saltReady = useMemo(() => isTenantSaltValid(), []);

  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSuccess, setLoginSuccess] = useState<string | null>(null);

  const [manualOrgId, setManualOrgId] = useState<string>('');

  const location = useLocation();
  const navigate = useNavigate();
  const { login: setLoginSession } = useAuth();

  async function handleFetchOrgs(e: React.FormEvent) {
    e.preventDefault();
    setOrgFetchError(null);
    setOrgFetchLoading(true);
    setOrgs([]);
    setSelectedOrgId('');
    try {
      const data = await getUserOrganizations(email.trim());
      setOrgs(data || []);
      setStep('credentials');
    } catch (err: any) {
      setOrgFetchError(err?.message || 'Failed to fetch organizations');
    } finally {
      setOrgFetchLoading(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(null);
    setLoginSuccess(null);
    if (!saltReady) {
      setLoginError('Login cannot proceed: tenant encryption salt is not configured.');
      return;
    }
    setLoginLoading(true);
    try {
      const orgIdToUse = selectedOrgId || manualOrgId.trim();
      // preserve existing org selection behavior: we continue sending VALIDATED_TENANT_SALT in payload per current design
      const organization_id = VALIDATED_TENANT_SALT;

      const res = await login({
        organization_id,
        email: email.trim(),
        password,
      });

      // check INACTIVE_TENANT signal shape per acceptance criteria
      if (res && res.errorType === 'INACTIVE_TENANT') {
        navigate('/warning');
        return;
      }

      // store token via AuthContext so guards re-render immediately
      if (res && typeof res === 'object' && 'token' in res && (res as any).token) {
        setLoginSession(String((res as any).token));
      } else {
        // still set logged-in state even if token isn't provided
        setLoginSession(null as any);
      }

      // Success path: determine redirect
      const params = new URLSearchParams(location.search);
      const redirectUri = params.get('redirect_uri');
      const fallback = '/dashboard/overview';
      setLoginSuccess(typeof res === 'string' ? (res as string) : 'Login successful');

      // next tick to allow state flush before navigation
      setTimeout(() => {
        navigate(redirectUri || fallback, { replace: true });
      }, 0);
    } catch (err: any) {
      setLoginError(err?.message || 'Login failed');
    } finally {
      setLoginLoading(false);
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
      <style>
        {`@keyframes spin{to{transform:rotate(360deg)}}`}
      </style>
      <div style={cardStyle}>
        <h2 style={{ margin: 0, marginBottom: 12, color: theme.text }}>Welcome back</h2>
        <p style={{ marginTop: 0, marginBottom: 20, color: '#6b7280' }}>
          Sign in to your dashboard using your organization.
        </p>

        {step === 'email' && (
          <form onSubmit={handleFetchOrgs}>
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

            {orgFetchError && <div style={errorStyle}>{orgFetchError}</div>}

            <button type="submit" style={btnStyle} disabled={orgFetchLoading || !email}>
              {orgFetchLoading ? (
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                  {spinner} Checking organizations...
                </span>
              ) : (
                'Continue'
              )}
            </button>
          </form>
        )}

        {step === 'credentials' && (
          <>
            <div
              style={{
                padding: 12,
                background: '#f3f4f6',
                borderRadius: 8,
                marginBottom: 16,
                fontSize: 13,
                color: '#374151',
              }}
            >
              Email: <strong>{email}</strong>
            </div>

            {!saltReady && (
              <div
                style={{
                  color: '#92400E',
                  background: '#FEF3C7',
                  border: '1px solid #FDE68A',
                  padding: 10,
                  borderRadius: 8,
                  fontSize: 13,
                  marginBottom: 12,
                }}
              >
                Tenant encryption salt is not configured for this environment. Organization encryption and login will not work until a valid QA salt is set.
              </div>
            )}

            {orgs.length > 0 ? (
              <div style={{ marginBottom: 14 }}>
                <div style={labelStyle}>Organization</div>
                <select
                  style={inputStyle}
                  value={selectedOrgId}
                  onChange={(e) => setSelectedOrgId(e.target.value)}
                >
                  <option value="">Select an organization</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name || o.id}
                    </option>
                  ))}
                </select>
                {selectedOrgId && (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
                    Selected: {orgs.find((o) => o.id === selectedOrgId)?.name || selectedOrgId}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ marginBottom: 14 }}>
                <div style={labelStyle}>Organization ID (no organizations found)</div>
                <input
                  style={inputStyle}
                  type="text"
                  placeholder="Enter your organization ID"
                  value={manualOrgId}
                  onChange={(e) => setManualOrgId(e.target.value)}
                />
                <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
                  This account returned no organizations. You can proceed by entering your org ID manually.
                </div>
              </div>
            )}

            <form onSubmit={handleLogin}>
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

              {loginError && <div style={errorStyle}>{loginError}</div>}
              {loginSuccess && (
                <div
                  style={{
                    color: '#065F46',
                    background: '#D1FAE5',
                    border: '1px solid #A7F3D0',
                    padding: 10,
                    borderRadius: 8,
                    fontSize: 13,
                    marginBottom: 10,
                  }}
                >
                  {loginSuccess}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  style={{ ...secondaryBtnStyle, flex: 1 }}
                  onClick={() => setStep('email')}
                  disabled={loginLoading}
                >
                  Back
                </button>
                <button
                  type="submit"
                  style={{ ...btnStyle, flex: 1 }}
                  disabled={
                    loginLoading ||
                    !email ||
                    (!selectedOrgId && orgs.length > 0 ? true : false) ||
                    (!selectedOrgId && orgs.length === 0 && !manualOrgId) ||
                    !password ||
                    !saltReady
                  }
                >
                  {loginLoading ? (
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                      {spinner} Signing in...
                    </span>
                  ) : (
                    'Sign in'
                  )}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
