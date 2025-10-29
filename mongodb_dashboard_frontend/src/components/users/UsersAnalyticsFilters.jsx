import React from 'react';
import './UsersAnalyticsFilters.css';

// PUBLIC_INTERFACE
export default function UsersAnalyticsFilters({
  organizations = [],
  departments = [],
  values,
  onChange,
  loading = false,
  error = null,
}) {
  /** Filter bar for Users Analytics with Organization, Department, and Date Range pickers. */
  const handleInput = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    onChange({ ...values, [key]: value });
  };

  const handleDate = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    onChange({ ...values, [key]: value || '' });
  };

  return (
    <div className="ua-filters">
      <div className="ua-filter-group">
        <label className="ua-label">Organization</label>
        <select
          className="ua-select"
          value={values.organization_id || ''}
          onChange={handleInput('organization_id')}
          disabled={loading}
        >
          <option value="">All</option>
          {organizations.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>

      <div className="ua-filter-group">
        <label className="ua-label">Department</label>
        <select
          className="ua-select"
          value={values.department || ''}
          onChange={handleInput('department')}
          disabled={loading}
        >
          <option value="">All</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      <div className="ua-filter-group">
        <label className="ua-label">Start date</label>
        <input
          type="date"
          className="ua-input"
          value={values.start_date || ''}
          onChange={handleDate('start_date')}
          max={values.end_date || undefined}
          disabled={loading}
        />
      </div>

      <div className="ua-filter-group">
        <label className="ua-label">End date</label>
        <input
          type="date"
          className="ua-input"
          value={values.end_date || ''}
          onChange={handleDate('end_date')}
          min={values.start_date || undefined}
          disabled={loading}
        />
      </div>

      {error ? (
        <div className="ua-error" role="alert">
          {String(error)}
        </div>
      ) : null}
    </div>
  );
}
