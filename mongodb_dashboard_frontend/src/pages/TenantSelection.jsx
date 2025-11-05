import React from 'react';
import { useAuth } from '../context/AuthContext';
import { getActiveTenant, selectTenant } from '../utils/tenantClient';

// PUBLIC_INTERFACE
export default function TenantSelection() {
  /**
   * TenantSelection (restricted)
   * Reads the single tenant_id from authenticated context/local state and renders only that tenant.
   * Does not fetch or list all tenants. Search/list-all is disabled by design.
   * If user is admin with multi-tenant capability, we still restrict to this tenant_id for now.
   */
  const { tenantId, getTenantId } = useAuth();
  const effectiveTenant = tenantId || getTenantId();

  const [error, setError] = React.useState(null);
  const currentTenant = effectiveTenant || getActiveTenant();

  const handleConfirm = async () => {
    try {
      if (!currentTenant) {
        throw new Error('No tenant is associated with your session.');
      }
      await selectTenant(String(currentTenant), 'confirm:single-tenant');
      window.location.replace('/dashboard/overview');
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <h2>Your tenant</h2>
      {!currentTenant ? (
        <p>No tenant is associated with your account. Please contact an administrator.</p>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              display: 'inline-block',
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              background: '#fff',
              color: '#111827',
              fontWeight: 600,
            }}
            aria-label="Current tenant id"
          >
            {String(currentTenant)}
          </div>
          <div style={{ marginTop: 16 }}>
            <button
              onClick={handleConfirm}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: '1px solid #2563EB',
                background: '#2563EB',
                color: '#fff',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Continue
            </button>
          </div>
        </div>
      )}
      {error && <p style={{ color: '#EF4444', marginTop: 12 }}>{String(error?.message || error)}</p>}
    </div>
  );
}
