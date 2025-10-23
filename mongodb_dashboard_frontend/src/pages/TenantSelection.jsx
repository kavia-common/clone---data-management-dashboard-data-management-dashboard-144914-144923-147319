import React, { useEffect, useState } from 'react';
import { setActiveTenantId } from '../utils/tenantSelection';

// PUBLIC_INTERFACE
export default function TenantSelection() {
  /**
   * Minimal TenantSelection page that lists tenants from a simple fetch endpoint if available,
   * falling back to an empty array. On selection, it stores the tenantId and redirects to root.
   */
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        // Try to load authorized tenants from backend. If it fails, continue with an empty list.
        const res = await fetch('/api/tenants?authorized=true');
        if (!res.ok) throw new Error('Failed to load tenants');
        const data = await res.json();
        if (!cancelled) setTenants(Array.isArray(data) ? data : (data.items || []));
      } catch (e) {
        if (!cancelled) setTenants([]);
        // keep UI minimal; optionally show error
        if (!cancelled) setError(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const handleSelect = (tenantId) => {
    setActiveTenantId(tenantId);
    // Redirect to dashboard root
    window.location.replace('/');
  };

  return (
    <div style={{ padding: 24 }}>
      <h2>Select a tenant</h2>
      {loading && <p>Loading...</p>}
      {!loading && tenants.length === 0 && (
        <p>No tenants were found for your account. Please contact an administrator.</p>
      )}
      {!loading && tenants.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {tenants.map((t) => {
            const id = t.tenant_id || t.id || t.tenantId || t._id || String(t);
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
      {error && <p style={{ color: '#EF4444' }}>{String(error)}</p>}
    </div>
  );
}
