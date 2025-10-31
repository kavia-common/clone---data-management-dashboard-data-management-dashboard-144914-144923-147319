import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAuthorizedTenants, setActiveTenant as apiSetActiveTenant } from '../api/session';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Skeleton from '../components/ui/Skeleton.jsx';
import { setActiveTenantLocal } from '../utils/tenantSelection';

/**
// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-FE-TENANT-SEL-001
// User Story: As a user, after logging in I should choose an active tenant to view the dashboard.
// Acceptance Criteria:
//  - Fetch list of authorized tenants for current user
//  - Allow selecting exactly one tenant
//  - Persist selection (localStorage) and call backend to set session context
//  - Navigate to /dashboard/overview on success
//  - Robust error handling and accessible UI
// GxP Impact: NO (UI), but supports compliant backend audit.
// Risk Level: LOW
// Validation Protocol: VP-FE-TENANT-SEL-001
// ============================================================================
 */

// PUBLIC_INTERFACE
export default function TenantSelection() {
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const canProceed = useMemo(() => !!selected && !loading, [selected, loading]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const { items } = await fetchAuthorizedTenants();
        if (!mounted) return;
        setTenants(items);
        if (items.length === 1) setSelected(items[0].id);
      } catch (e) {
        console.error(e);
        if (!mounted) return;
        setError(e?.message || 'Failed to load tenants.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleContinue() {
    if (!selected) return;
    setError('');
    try {
      // Persist locally first for optimistic UX
      setActiveTenantLocal(selected);
      // Inform backend for audit + server-side context
      await apiSetActiveTenant(selected);
      navigate('/dashboard/overview', { replace: true });
    } catch (e) {
      console.error(e);
      setError(e?.message || 'Failed to set active tenant. Please try again.');
    }
  }

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24, background: '#f9fafb' }}>
      <Card style={{ width: 520, maxWidth: '95vw' }}>
        <h2 style={{ marginTop: 0, marginBottom: 8 }}>Select your tenant</h2>
        <div className="muted" style={{ marginBottom: 16 }}>
          Choose the organization to view dashboard data.
        </div>

        {loading ? (
          <div style={{ padding: '16px 0' }}>
            <Skeleton width="100%" height={24} />
            <Skeleton width="100%" height={24} />
            <Skeleton width="60%" height={24} />
          </div>
        ) : error ? (
          <div className="error" role="alert" style={{ marginBottom: 16 }}>
            {error}
          </div>
        ) : tenants.length === 0 ? (
          <div className="muted">No tenants available for your account.</div>
        ) : (
          <div role="radiogroup" aria-label="Tenants" style={{ display: 'grid', gap: 8 }}>
            {tenants.map((t) => (
              <label key={t.id} className="ui-input" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12 }}>
                <input
                  type="radio"
                  name="tenant"
                  value={t.id}
                  checked={selected === t.id}
                  onChange={() => setSelected(t.id)}
                  aria-checked={selected === t.id}
                />
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600 }}>{t.name || t.id}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{t.id}</span>
                </div>
              </label>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <Button onClick={handleContinue} disabled={!canProceed}>
            Continue
          </Button>
        </div>
      </Card>
    </div>
  );
}
