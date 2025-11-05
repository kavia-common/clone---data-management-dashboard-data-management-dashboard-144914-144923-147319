import React from 'react';

/**
 * PUBLIC_INTERFACE
 * OverviewEmptyState
 * A tiny, reusable empty/loading state used as a non-intrusive placeholder.
 */
const OverviewEmptyState = ({ message = 'No data available yet.' }) => {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: '12px',
        color: '#6b7280',
        fontSize: 14,
      }}
    >
      {message}
    </div>
  );
};

export default OverviewEmptyState;
