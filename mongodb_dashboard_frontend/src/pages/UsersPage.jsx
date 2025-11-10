import React from 'react';
import MostActiveUsersChart from '../components/users/MostActiveUsersChart';

// PUBLIC_INTERFACE
export default function UsersPage() {
  // In a real app, token and tenantId would come from auth context / selection UI
  const token = window.localStorage.getItem('auth_token') || null;
  const tenantId = window.localStorage.getItem('active_tenant') || null;

  return (
    <div style={{ padding: 16 }}>
      <MostActiveUsersChart range="30d" granularity="daily" topN={5} token={token} tenantId={tenantId} />
    </div>
  );
}
