import React from 'react';
import ActiveUsersChart from './ActiveUsersChart.jsx';
/**
 * PUBLIC_INTERFACE
 * ActiveUsersChartWrapper
 * Simplified wrapper without date range. Only forwards tenant and status.
 */
export default function ActiveUsersChartWrapper({ tenant_id, status = 'completed|active' }) {
  return (
    <ActiveUsersChart
      status={status}
      tenant_id={tenant_id}
    />
  );
}
