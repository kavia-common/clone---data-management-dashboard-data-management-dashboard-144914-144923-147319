import React, { useState, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { fetchUserOrganizationsByEmail, loginWithOrgEmailPassword } from '../api/authClient';
import { useAuth } from '../context/AuthContext';
import './Login.css'; // optional, if exists; otherwise ignore

const DEFAULT_REDIRECT = '/dashboard';

export default function Login() {
  // Basic inputs
  const [email, setEmail] = useState('');
  // Store the API response exactly as returned: { email, organizations }
  const [orgResponse, setOrgResponse] = useState(null);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [password, setPassword] = useState('');
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [loadingLogin, setLoadingLogin] = useState(false);
  const [error, setError] = useState('');

  const location = useLocation();
  const navigate = useNavigate();
  const { login } = useAuth();

  const canFind = useMemo(() => email && !loadingOrgs, [email, loadingOrgs]);
  const canLogin = useMemo(() => email && selectedOrgId && password && !loadingLogin, [email, selectedOrgId, password, loadingLogin]);

  // target after successful login
  const SUCCESS_REDIRECT = '/dashboard/overview';

  async function handleFindOrgs() {
    setError('');
    if (!email) {
      setError('Please enter an email to look up organizations.');
      return;
    }
    setLoadingOrgs(true);
    try {
      const resp = await fetchUserOrganizationsByEmail(email);
      // resp expected: { email, organizations }
      setOrgResponse(resp);
      const items = Array.isArray(resp?.organizations) ? resp.organizations : [];
      if (items.length === 0) {
        setSelectedOrgId('');
        setError('No organizations found for this email.');
      } else {
        // auto-select first
        setSelectedOrgId(items[0]?.id || '');
      }
    } catch (e) {
      console.error(e);
      setError(e.message || 'Failed to fetch organizations. Please try again.');
      setOrgResponse(null);
      setSelectedOrgId('');
    } finally {
      setLoadingOrgs(false);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    if (!email || !selectedOrgId || !password) {
      setError('Please provide email, organization and password.');
      return;
    }
    setLoadingLogin(true);
    try {
      const { token } = await loginWithOrgEmailPassword({
        organizationId: selectedOrgId,
        email,
        password,
        // Optional: pass a custom salt if provided in env via REACT_APP_TENANT_ENCRYPTION_SALT
      });

      // Persist and propagate auth state via context provider
      login(token || null);

      // Navigate to dashboard overview or 'from' if provided
      const from = location.state?.from?.pathname || SUCCESS_REDIRECT;
      navigate(from, { replace: true });
    } catch (e) {
      console.error('Login error', e);
      const status = e?.status;
      if (status === 401 || status === 403) {
        setError('Invalid credentials. Please check your email, organization, and password.');
      } else if (status === 404) {
        setError('Login endpoint not found or user not found.');
      } else {
        setError(e.message || 'Login failed. Please try again.');
      }
    } finally {
      setLoadingLogin(false);
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>Sign in</h2>

        {error ? <div style={styles.error}>{error}</div> : null}

        <div style={styles.field}>
          <label style={styles.label}>Email</label>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={styles.input}
          />
        </div>

        <div style={styles.actionsRow}>
          <button onClick={handleFindOrgs} disabled={!canFind} style={{ ...styles.button, ...(canFind ? {} : styles.buttonDisabled) }}>
            {loadingOrgs ? 'Finding...' : 'Find Organizations'}
          </button>
        </div>

        {orgResponse?.email ? (
          <div style={styles.field}>
            <label style={styles.label}>Email (from server)</label>
            <div style={{ fontSize: 14, color: '#111827' }}>{orgResponse.email}</div>
          </div>
        ) : null}

        <div style={styles.field}>
          <label style={styles.label}>Organization</label>
          <select
            value={selectedOrgId}
            onChange={(e) => setSelectedOrgId(e.target.value)}
            style={styles.select}
          >
            <option value="">Select organization...</option>
            {(orgResponse?.organizations || []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Password</label>
          <input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
          />
        </div>

        <div style={styles.actionsRow}>
          <button onClick={handleLogin} disabled={!canLogin} style={{ ...styles.buttonPrimary, ...(canLogin ? {} : styles.buttonDisabled) }}>
            {loadingLogin ? 'Signing in...' : 'Login'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f9fafb',
    padding: '2rem',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    background: '#ffffff',
    borderRadius: 12,
    boxShadow: '0 10px 25px rgba(0,0,0,0.08)',
    padding: '1.5rem',
  },
  title: {
    margin: 0,
    marginBottom: '1rem',
    fontSize: 22,
    color: '#111827',
    fontWeight: 700,
  },
  field: {
    marginBottom: '1rem',
  },
  label: {
    display: 'block',
    marginBottom: 6,
    color: '#374151',
    fontSize: 13,
    fontWeight: 600,
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    fontSize: 14,
    outline: 'none',
  },
  select: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    fontSize: 14,
    outline: 'none',
    backgroundColor: '#fff',
  },
  actionsRow: {
    display: 'flex',
    gap: 8,
    marginTop: 4,
    marginBottom: 8,
  },
  button: {
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    background: '#ffffff',
    color: '#111827',
    cursor: 'pointer',
    fontWeight: 600,
  },
  buttonPrimary: {
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid #2563EB',
    background: '#2563EB',
    color: '#ffffff',
    cursor: 'pointer',
    fontWeight: 700,
    width: '100%',
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  error: {
    background: '#FEF2F2',
    color: '#B91C1C',
    border: '1px solid #FECACA',
    borderRadius: 8,
    padding: '8px 10px',
    marginBottom: '10px',
    fontSize: 13,
  },
};
