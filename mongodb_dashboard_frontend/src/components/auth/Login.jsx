import React, { useState, useContext } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import '../../styles/theme.css';
import '../../index.css';
import { getApiClient } from '../../api/client';
import { AuthContext } from '../../context/AuthContext';

const colors = {
  primary: '#2563EB',
  secondary: '#F59E0B',
  error: '#EF4444',
  background: '#f9fafb',
  surface: '#ffffff',
  text: '#111827',
};

/**
 * PUBLIC_INTERFACE
 * Login form for authenticating with email/password and organization ID.
 * - Uses named getApiClient() from ../../api/client (no default import)
 * - Calls POST /auth/login
 * - On success, stores token as 'auth_token', updates AuthContext if present,
 *   and redirects to /overview (or previous location if provided).
 */
export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useContext(AuthContext); // optional; may be undefined if not wrapped
  const [form, setForm] = useState({ organization_id: 'org_123', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const from = location.state?.from?.pathname || '/overview';

  const onChange = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  };

  // PUBLIC_INTERFACE
  async function onSubmit(e) {
    /** Handles login by posting to /auth/login using getApiClient(). */
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const client = getApiClient();
      const res = await client.post('/auth/login', {
        organization_id: form.organization_id,
        email: form.email,
        password: form.password,
      });

      // Extract token from common shapes: string body, or { token|access_token|jwt }
      const data = res?.data;
      const token =
        (typeof data === 'string' && data) ||
        data?.token ||
        data?.access_token ||
        data?.jwt ||
        '';

      if (!token) {
        throw new Error('No token received from server.');
      }

      // Save token for interceptors
      localStorage.setItem('auth_token', token);

      // Update auth context if available
      if (auth && typeof auth.login === 'function') {
        try {
          await auth.login(
            { organization_id: form.organization_id, email: form.email, password: form.password },
            client
          );
        } catch {
          // ignore context errors; localStorage + interceptors will handle auth
        }
      }

      // Redirect so other modules load with auth
      navigate(from, { replace: true });
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data ||
        err?.message ||
        'Invalid credentials. Please try again.';
      setError(typeof msg === 'string' ? msg : 'Login failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: colors.background, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ width: '100%', maxWidth: 420, background: colors.surface, borderRadius: 12, boxShadow: '0 10px 25px rgba(0,0,0,0.08)', padding: 24 }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: colors.text }}>Welcome back</div>
          <div style={{ fontSize: 14, color: '#6B7280', marginTop: 4 }}>Sign in to your dashboard</div>
        </div>

        <form onSubmit={onSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: 13, color: '#374151' }}>
              Organization ID
              <input
                name="organization_id"
                value={form.organization_id}
                onChange={onChange}
                placeholder="e.g., org_123"
                required
                style={{
                  marginTop: 6,
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid #E5E7EB',
                  outline: 'none',
                  color: colors.text,
                }}
              />
            </label>

            <label style={{ fontSize: 13, color: '#374151' }}>
              Email
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={onChange}
                placeholder="you@example.com"
                required
                style={{
                  marginTop: 6,
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid #E5E7EB',
                  outline: 'none',
                  color: colors.text,
                }}
              />
            </label>

            <label style={{ fontSize: 13, color: '#374151' }}>
              Password
              <input
                type="password"
                name="password"
                value={form.password}
                onChange={onChange}
                placeholder="••••••••"
                required
                style={{
                  marginTop: 6,
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid #E5E7EB',
                  outline: 'none',
                  color: colors.text,
                }}
              />
            </label>
          </div>

          {error ? (
            <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: '#FEE2E2', color: colors.error, border: '1px solid #FCA5A5' }}>
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 16,
              width: '100%',
              padding: '10px 12px',
              background: loading ? '#93C5FD' : colors.primary,
              color: 'white',
              border: 'none',
              borderRadius: 8,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              transition: 'background 0.2s ease',
            }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div style={{ marginTop: 12, textAlign: 'center', fontSize: 12, color: '#6B7280' }}>
          By signing in you agree to the Terms and Privacy Policy.
        </div>
      </div>
    </div>
  );
}
