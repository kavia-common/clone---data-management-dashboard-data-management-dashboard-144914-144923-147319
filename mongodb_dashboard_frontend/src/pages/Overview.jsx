import React from 'react';
import DashboardOverview from './dashboard/Overview.jsx';

/**
 * PUBLIC_INTERFACE
 * Top-level Overview that reuses dashboard Overview (without dynamic modules fetch).
 */
export default function Overview() {
  return <DashboardOverview />;
}
