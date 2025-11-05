import React, { useEffect, useState } from 'react';
import { fetchSessionTenants, selectTenant, normalizeTenantId } from '../utils/tenantClient';

// PUBLIC_INTERFACE
export default function TenantSelection() {
  /**
   * TenantSelection page that lists authorized tenants via GET /api/session/tenants.
   * On selection, it calls POST /api/tenants/select (cookie-based) and navigates to dashboard.
   * Keeps UI minimal and single-selection.
   */
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const data = await fetchSessionTenants();
        if (!cancelled) setTenants(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) setTenants([]);
        if (!cancelled) setError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const handleSelect = async (tenantId) => {
    try {
      await selectTenant(tenantId, 'user-selection:tenant-selection-page');
      // Redirect to the dashboard overview after successful selection
      window.location.replace('/dashboard/overview');
    } catch (e) {
      // keep UI minimal; show a simple error
      setError(e);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <h2>Select a tenant</h2>
      {loading && <p>Loading tenants…</p>}
      {!loading && tenants.length === 0 && (
        <p>No tenants were found for your account. Please contact an administrator.</p>
      )}
      {!loading && tenants.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {tenants.map((t) => {
            const id = normalizeTenantId(t);
            const name = t.tenant_name || t.name || id;
            return (
              <li key={id} style={{ marginBottom: 12 }}>
                <button
                  onClick={() => handleSelect(id)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: '1px solid #e5e7eb',
                    background: '#fff',
                    cursor: 'pointer'
                  }}
                >
                  {name}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p style={{ color: '#EF4444' }}>{String(error?.message || error)}</p>}
    </div>
  );
}
