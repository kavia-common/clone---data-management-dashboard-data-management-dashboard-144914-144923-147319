import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { fetchUserOrganizationsByEmail, loginWithOrgEmailPassword } from '../api/authClient';
import { useAuth } from '../context/AuthContext';

import Input from '../components/ui/Input.jsx';
import Button from '../components/ui/Button.jsx';
import './Login.css';
import appLogo from '../assets/logo/app-logo-2025.png'; // REQ-UI-LOGO-REPLACE: reuse sidebar logo

export default function Login() {
  const [email, setEmail] = useState('');
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
  const canLogin = useMemo(
    () => email && selectedOrgId && password && !loadingLogin,
    [email, selectedOrgId, password, loadingLogin]
  );

  const SUCCESS_REDIRECT = '/dashboard/overview';

  // 🔹 Fetch organizations for given email
  // 🔹 Fetch organizations for given email
  async function handleFindOrgs() {
    setError('');
    if (!email) {
      setError('Please enter an email to look up organizations.');
      return;
    }
    setLoadingOrgs(true);
    try {
      const resp = await fetchUserOrganizationsByEmail(email);
      setOrgResponse(resp);
      const items = Array.isArray(resp?.organizations) ? resp.organizations : [];


      if (items.length === 0) {
        setSelectedOrgId('');
        setError('No organizations found for this email.');
      } else {
        // ✅ Try to auto-select "Kavia B2C"
        const kaviaOrg = items.find(
          (org) => org.name?.toLowerCase() === 'kavia b2c'
        );
        // ✅ If found, auto-select it, else keep empty
        setSelectedOrgId(kaviaOrg?.id || '');
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

  // 🔹 Trigger when user selects organization manually
  function handleOrganizationSelect(e) {
    const selectedId = e.target.value;
    setSelectedOrgId(selectedId);

    // ✅ Add your custom logic here
    console.log('✅ Selected Organization ID:', selectedId);

    // Example: If you want to also log org name or send event
    const selectedOrg = orgResponse?.organizations?.find((o) => o.id === selectedId);
    if (selectedOrg) {
      console.log('✅ Selected Organization Name:', selectedOrg.name);
    }

    // You could also trigger something like:
    // triggerEncryption(selectedId);
    // or storeOrganization(selectedId);
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
      const { token, payload } = await loginWithOrgEmailPassword({
        organizationId: selectedOrgId,
        email,
        password,
      });
      // Persist token and any tenant info provided by backend (if present)
      const maybeTenant = (payload && (payload.tenant_id || payload.tenantId)) || null;
      login({ token: token || null, tenant_id: maybeTenant });
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
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-header">
          <img
            src={appLogo}
            alt="Company logo"
            className="auth-logo"
            style={{ height: 36, width: 'auto' }}
          />
          <h2 style={{ margin: 0 }}>Sign in</h2>
          <div className="muted" style={{ marginTop: 4 }}>Access your dashboard</div>
        </div>

        <div className="auth-form">
          {error ? <div className="error" role="alert">{error}</div> : null}

          <label>
            <span>Email</span>
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email address"
            />
          </label>

          <div className="toolbar" style={{ padding: 0 }}>
            <Button
              type="button"
              variant="secondary"
              onClick={handleFindOrgs}
              disabled={!canFind}
              aria-label="Find organizations for this email"
              className="w-full"
            >
              {loadingOrgs ? 'Finding…' : 'Find Organizations'}
            </Button>
          </div>

          {orgResponse?.email ? (
            <div className="muted" aria-live="polite">
              Email (from server): <strong style={{ color: 'inherit' }}>{orgResponse.email}</strong>
            </div>
          ) : null}

          <label>
            <span>Organization</span>
            <select
              className="ui-input"
              value={selectedOrgId}
              onChange={handleOrganizationSelect} // 🔹 updated here
              aria-label="Organization"
            >
              <option value="">Select organization...</option>
              {(orgResponse?.organizations || []).map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Password</span>
            <Input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label="Password"
            />
          </label>

          <Button
            type="button"
            onClick={handleLogin}
            disabled={!canLogin}
            className="w-full"
          >
            {loadingLogin ? 'Signing in…' : 'Login'}
          </Button>
        </div>

        <div className="auth-footer">
          <div className="muted">By signing in you agree to the Terms and Privacy Policy.</div>
        </div>
      </div>
    </div>
  );
}
 
 