import React from 'react';
import { FeatureUsageChart } from '../modules/session-tracking';

const SessionTrackingPage: React.FC = () => {
  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Session Tracking</h2>
      <p style={{ color: '#6b7280' }}>Analyze how features are used across sessions by service type.</p>
      <FeatureUsageChart />
    </div>
  );
};

export default SessionTrackingPage;
