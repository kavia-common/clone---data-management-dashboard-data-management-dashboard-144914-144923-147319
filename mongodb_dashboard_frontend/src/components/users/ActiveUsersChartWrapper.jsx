import React from 'react';
import ActiveUsersChart from './ActiveUsersChart.jsx';
import useDateRangeQuery from '../../hooks/useDateRangeQuery';

/**
 * PUBLIC_INTERFACE
 * ActiveUsersChartWrapper
 * Provides startDate/endDate via URL-synced hook and forwards both start/end and from/to
 * so child charts and APIs receive consistent date filters. Refetches on change naturally.
 */
export default function ActiveUsersChartWrapper({ tenant_id, status = 'completed|active' }) {
  const { startDate, endDate, withDateParams } = useDateRangeQuery();
  const params = withDateParams({}); // includes from/to and start/end

  return (
    <ActiveUsersChart
      {...params}
      status={status}
      tenant_id={tenant_id}
    />
  );
}
