import React from 'react';

/**
 * PUBLIC_INTERFACE
 * DateRangeFilter
 * A minimal date range picker component using native input[type="date"] controls.
 * Props:
 *  - startDate (string YYYY-MM-DD or ISO)
 *  - endDate (string YYYY-MM-DD or ISO)
 *  - onChange({ startDate, endDate })
 */
export default function DateRangeFilter({ startDate, endDate, onChange }) {
  const toInput = (v) => {
    if (!v) return '';
    // Accept ISO or YYYY-MM-DD; convert ISO to date part
    try {
      if (v.length > 10) {
        const d = new Date(v);
        if (!Number.isNaN(d.getTime())) {
          const yyyy = d.getUTCFullYear();
          const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(d.getUTCDate()).padStart(2, '0');
          return `${yyyy}-${mm}-${dd}`;
        }
      }
    } catch {}
    return v.slice(0, 10);
  };

  const fromInput = (v) => (v ? `${v}T00:00:00.000Z` : '');
  const toEndOfDay = (v) => (v ? `${v}T23:59:59.999Z` : '');

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
      <label style={{ fontSize: 12, color: '#374151' }}>
        Start
        <input
          type="date"
          value={toInput(startDate)}
          onChange={(e) => onChange({ startDate: fromInput(e.target.value), endDate })}
          style={{ marginLeft: 6 }}
        />
      </label>
      <label style={{ fontSize: 12, color: '#374151' }}>
        End
        <input
          type="date"
          value={toInput(endDate)}
          onChange={(e) => onChange({ startDate, endDate: toEndOfDay(e.target.value) })}
          style={{ marginLeft: 6 }}
        />
      </label>
      {(startDate || endDate) && (
        <button
          type="button"
          onClick={() => onChange({ startDate: '', endDate: '' })}
          style={{
            marginLeft: 8,
            padding: '4px 8px',
            borderRadius: 6,
            background: '#E5E7EB',
            border: '1px solid #D1D5DB',
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}
