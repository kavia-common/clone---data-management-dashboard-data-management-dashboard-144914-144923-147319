//
// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-FE-TENANT-SELECT-UI-001
// User Story: Prompt users to pick a tenant after sign-in; auto-select if only one; show friendly message if none.
// Acceptance Criteria: See backend endpoints, selection persistence, and redirects to dashboard.
// GxP Impact: YES - Ensures correct scoping and provides attributable action via backend audit.
// Risk Level: LOW
// ============================================================================
// IMPORTS AND DEPENDENCIES
// ============================================================================
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listAccessibleTenants, selectTenant } from '../utils/tenantSelection';

// PUBLIC_INTERFACE
export default function TenantSelection() {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const items = await listAccessibleTenants();
        if (!mounted) return;
        if (items.length === 0) {
          setTenants([]);
          setLoading(false);
          return;
        }
        if (items.length === 1) {
          const t = items[0];
          await selectTenant(t.id, 'auto-select: single tenant');
          navigate('/dashboard', { replace: true });
          return;
        }
        setTenants(items);
        setLoading(false);
      } catch (e) {
        setError('Failed to load tenants');
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [navigate]);

  const onSelect = async (tenantId) => {
    try {
      await selectTenant(tenantId, 'user selection');
      navigate('/dashboard', { replace: true });
    } catch (e) {
      setError('Failed to select tenant. Please try again.');
    }
  };

  if (loading) {
    return <div className="p-6">Loading tenants…</div>;
  }
  if (error) {
    return <div className="p-6 text-red-600">{error}</div>;
  }
  if (tenants.length === 0) {
    return (
      <div className="p-6">
        <h2 className="text-xl font-semibold mb-2">No tenants available</h2>
        <p className="text-gray-600">Your account is not associated with any tenants. Please contact your administrator.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold mb-4">Select a tenant</h2>
      <ul className="space-y-3">
        {tenants.map((t) => (
          <li key={t.id}>
            <button
              className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 transition"
              onClick={() => onSelect(t.id)}
            >
              {t.name || t.id}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
