/**
 * PUBLIC_INTERFACE
 * AllTenantsIndicator
 * Small UI badge to indicate when Super Admin global mode is active.
 */
import React from 'react';
import { isAllTenantsEnabled, toggleAllTenants } from '../auth/organizations';

export default function AllTenantsIndicator() {
  const [enabled, setEnabled] = React.useState(isAllTenantsEnabled());
  const onToggle = async () => {
    const next = !enabled;
    await toggleAllTenants(next).catch(() => {});
    setEnabled(next);
  };
  return (
    <button
      onClick={onToggle}
      style={{
        padding: '4px 8px',
        borderRadius: 6,
        border: '1px solid #93C5FD',
        background: enabled ? '#DBEAFE' : '#F3F4F6',
        color: '#1F2937',
        fontSize: 12,
        cursor: 'pointer',
        marginLeft: 8,
      }}
      title="Toggle global all-tenants mode (Super Admin only)"
    >
      {enabled ? 'All tenants: ON' : 'All tenants: OFF'}
    </button>
  );
}
