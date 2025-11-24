import React, { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import Button from '../ui/Button.jsx';
import { useDataContext } from '../../context/DataContext.jsx';
import { toTitleCaseName } from '../../utils/stringFormatters.js';
import { usdToCredits, formatCredits, parseUsdToNumber } from '../../utils/currency.js';
import { formatCurrencyAmount } from '../../utils/formatCurrency';
import { getUserBasic } from '../../api/users';
import { SessionTrackingChart } from "./SessionTrackingChart";
import './SessionDetailsModal.css';

// ... [rest of the file remains unchanged until the main return section] ...

function SessionDetailsModal({ open, onClose, session }) {
  // ... (existing prop logic above) ...

  // Insert: Breakdown chart if breakdown has event_type
  const breakdown = session?.session_breakdown;
  let pieData = [];
  if (Array.isArray(breakdown) && breakdown.length && "event_type" in breakdown[0]) {
    const counts = {};
    breakdown.forEach(b => {
      const t = b.event_type || "Other";
      counts[t] = (counts[t] || 0) + 1;
    });
    pieData = Object.entries(counts).map(([k, v]) => ({ x: k, y: v }));
  }

  const chartFiltersConfig = { fields: [], xKey: "x", yKey: "y" };

  // ... (rest of the setup and return logic, with integration)
  // In the JSX return, add the chart section above or below 'Session Breakdowns'
  // Within the main <div ref={contentRef} ...>

  // [EXISTING CODE UP TO THE RENDERED HEADER, THEN:]
  return (
    <Modal open={open} onClose={onClose} title={title} className="session-details-modal modal--session modal--session-details">
      {/* Header, etc... */}

      {/* Body */}
      <div
        ref={contentRef}
        tabIndex={-1}
        id={`${headerId}-content`}
        style={{
          padding: 24,
          gap: 16,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'auto',
          WebkitOverflowScrolling: 'touch',
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
          flex: 1,
          minHeight: 0,
          background: 'var(--bg-canvas, #f9fafb)',
        }}
      >
        {/* Core Details grid */}
        {/* ... unchanged ... */}
        <section
          aria-label="Session breakdown"
          className="details-card"
          style={{
            position: 'relative',
            background: 'var(--bg-surface, #ffffff)',
            border: '1px solid var(--border-subtle, #E5E7EB)',
            borderRadius: 16,
            padding: 24,
            boxShadow: '0 8px 24px rgba(16,24,40,0.08)',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            maxHeight: '520px',
            minHeight: '240px',
            overflowY: 'auto',
            overflowX: 'hidden',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {/* ... core details ... */}
        </section>
        {/* ===== NEW PIE CHART SECTION ===== */}
        {pieData.length > 0 && (
          <div style={{ width: "100%", maxWidth: 360, alignSelf: "center" }}>
            <SessionTrackingChart
              data={pieData}
              loading={false}
              error={null}
              chartType="pie"
              filtersConfig={chartFiltersConfig}
              height={220}
              label="Event Type Breakdown"
              ariaLabel="Session event type breakdown"
              theme={{ colors: ["#2563EB", "#F59E0B", "#22d3ee", "#4ade80", "#EF4444"] }}
            />
          </div>
        )}
        {/* ========== END CHART SECTION ========== */}
        {/* ... rest of modal breakdown, unchanged ... */}
      </div>
      {/* Footer ... */}
      {/* ... CSS-in-JS ... */}
    </Modal>
  );
}

export default SessionDetailsModal;
