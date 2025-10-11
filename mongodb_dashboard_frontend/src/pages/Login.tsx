import React, { useMemo, useState } from 'react';
import { getUserOrganizations, login } from '../api/authClient';
import { encryptTenantId } from '../utils/crypto';
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

export default function Login() {
  const [step, setStep] = useState<'email' | 'credentials'>('email');

  const [email, setEmail] = useState('');
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [orgFetchLoading, setOrgFetchLoading] = useState(false);
  const [orgFetchError, setOrgFetchError] = useState<string | null>(null);

  const [selectedOrgId, setSelectedOrgId] = useState<string>('');
  const encryptedOrgId = useMemo(() => {
    try {
      return selectedOrgId ? encryptTenantId(selectedOrgId) : '';
    } catch {
      return '';
    }
  }, [selectedOrgId]);

  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSuccess, setLoginSuccess] = useState<string | null>(null);

  const [manualOrgId, setManualOrgId] = useState<string>('');

  async function handleFetchOrgs(e: React.FormEvent) {
    e.preventDefault();
    setOrgFetchError(null);
    setOrgFetchLoading(true);
    setOrgs([]);
    setSelectedOrgId('');
    try {
      const data = await getUserOrganizations(email.trim());
      setOrgs(data || []);
      if (!data || data.length === 0) {
        // allow manual input step
      }
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
    setLoginLoading(true);
    try {
      const orgIdToUse = selectedOrgId || manualOrgId.trim();
      const enc = encryptTenantId(orgIdToUse);
      const res = await login({
        organization_id: enc, // per instruction, send encrypted
        email: email.trim(),
        password,
      });
      // store token if any
      if (res && typeof res === 'object' && 'token' in res && res.token) {
        try {
          localStorage.setItem('authToken', String(res.token));
        } catch {
          // ignore storage issues
        }
      }
      setLoginSuccess(typeof res === 'string' ? res : 'Login successful');
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
                    <br />
                    Encrypted ID: <code>{encryptedOrgId.slice(0, 10)}...</code>
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
                    !password
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
