import React, { useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import './DateRangeFilter.css';

/**
 * PUBLIC_INTERFACE
 * DateRangeFilter
 * A reusable date range filter component with start and end date inputs, consistent with the Ocean Professional theme.
 * - Props:
 *   - startDate: string | null (ISO YYYY-MM-DD)
 *   - endDate: string | null (ISO YYYY-MM-DD)
 *   - onChange: function({ startDate, endDate })
 *   - onClear: function() to clear both dates
 *   - className: optional className
 * Usage:
 *   <DateRangeFilter startDate={start} endDate={end} onChange={setDates} onClear={() => setDates({startDate:null,endDate:null})}/>
 */
export default function DateRangeFilter({ startDate, endDate, onChange, onClear, className = '' }) {
  const handleStart = useCallback(
    (e) => {
      const v = e.target.value || null;
      onChange({ startDate: v, endDate });
    },
    [endDate, onChange]
  );

  const handleEnd = useCallback(
    (e) => {
      const v = e.target.value || null;
      onChange({ startDate, endDate: v });
    },
    [startDate, onChange]
  );

  const disabledClear = useMemo(() => !startDate && !endDate, [startDate, endDate]);

  return (
    <div className={`km-dd DateRangeFilter ${className}`}>
      <div className="drf-field">
        <label className="drf-label" htmlFor="drf-start">Start date</label>
        <input
          id="drf-start"
          type="date"
          className="drf-input"
          value={startDate || ''}
          onChange={handleStart}
          aria-label="Start date"
        />
      </div>
      <div className="drf-field">
        <label className="drf-label" htmlFor="drf-end">End date</label>
        <input
          id="drf-end"
          type="date"
          className="drf-input"
          value={endDate || ''}
          onChange={handleEnd}
          aria-label="End date"
        />
      </div>
      <button
        type="button"
        className="drf-clear"
        onClick={onClear}
        disabled={disabledClear}
        aria-disabled={disabledClear}
        title="Clear date filters"
      >
        Clear
      </button>
    </div>
  );
}

DateRangeFilter.propTypes = {
  startDate: PropTypes.string,
  endDate: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  onClear: PropTypes.func.isRequired,
  className: PropTypes.string,
};
