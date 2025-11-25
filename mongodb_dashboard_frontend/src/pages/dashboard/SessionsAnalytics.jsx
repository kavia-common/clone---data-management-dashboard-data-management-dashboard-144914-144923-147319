import React, { useMemo, useRef, useState } from 'react';
import SessionsPerDayBarChart from '../../components/charts/SessionsPerDayBarChart';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { leadingTrailingDebounce } from '../../utils/debounce';
import './SessionsAnalytics.css';

/**
 * PUBLIC_INTERFACE
 * Sessions Analytics page that displays a bar chart of sessions-per-day with simple filters.
 * Filters supported:
 *  - tenant_id, project_id, status
 *  - start, end (ISO date)
 */
export default function SessionsAnalytics() {
  const [tenant, setTenant] = useState('');
  const [project, setProject] = useState('');
  const [status, setStatus] = useState('');
  const [applied, setApplied] = useState({ tenant: '', project: '', status: '' });

  const debRef = useRef(leadingTrailingDebounce((next) => {
    setApplied((prev) => ({ ...prev, ...next }));
  }, 400));

  const filters = useMemo(() => ({
    tenant_id: applied.tenant || undefined,
    project_id: applied.project || undefined,
    status: applied.status || undefined,
  }), [applied]);

  return (
    <div className="sessions-analytics-page">
      <h1>Sessions Analytics</h1>
      <Card title="Filters">
        <div className="filters-row">
          <div className="filter-item">
            <label>Tenant ID</label>
            <Input
              value={tenant}
              onChange={(e) => {
                const v = e.target.value;
                setTenant(v);
                debRef.current({ tenant: v });
              }}
              placeholder="tenant_id"
            />
          </div>
          <div className="filter-item">
            <label>Project ID</label>
            <Input
              value={project}
              onChange={(e) => {
                const v = e.target.value;
                setProject(v);
                debRef.current({ project: v });
              }}
              placeholder="project_id"
            />
          </div>
          <div className="filter-item">
            <label>Status</label>
            <Input
              value={status}
              onChange={(e) => {
                const v = e.target.value;
                setStatus(v);
                debRef.current({ status: v });
              }}
              placeholder="completed|active"
            />
          </div>
          <div className="filter-actions">
            <Button onClick={() => setApplied({ tenant, project, status })}>Apply</Button>
            <Button variant="secondary" onClick={() => { setTenant(''); setProject(''); setStatus(''); setApplied({ tenant: '', project: '', status: '' }); }}>Reset</Button>
          </div>
        </div>
      </Card>

      <SessionsPerDayBarChart filters={filters} />
    </div>
  );
}
