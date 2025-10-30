import React from 'react';
import UsersActivityChart from './UsersActivityChart';
import UsersSummaryCards, { SummaryValue } from './UsersSummaryCards';
import { fetchUsersActivity, fetchUsersSummary } from '../../../api/analyticsUsers';

type Granularity = 'daily' | 'weekly' | 'monthly';
type RoleFilter = 'all' | 'admin' | 'user';

function useDebounced<T>(value: T, delay = 500) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

const UsersAnalyticsPanel: React.FC = () => {
  const now = React.useMemo(() => new Date(), []);
  const defaultStart = React.useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  }, []);

  const [granularity, setGranularity] = React.useState<Granularity>('daily');
  const [role, setRole] = React.useState<RoleFilter>('all');
  const [department, setDepartment] = React.useState('');
  const [status, setStatus] = React.useState('active');
  const [start, setStart] = React.useState(defaultStart.toISOString().slice(0, 10));
  const [end, setEnd] = React.useState(now.toISOString().slice(0, 10));
  const [organizationId, setOrganizationId] = React.useState('');

  const dGranularity = useDebounced(granularity);
  const dRole = useDebounced(role);
  const dDepartment = useDebounced(department);
  const dStatus = useDebounced(status);
  const dStart = useDebounced(start);
  const dEnd = useDebounced(end);
  const dOrg = useDebounced(organizationId);

  const [loading, setLoading] = React.useState(false);
  const [series, setSeries] = React.useState<{ date: string; total: number; admin: number; user: number }[]>([]);
  const [summaryLoading, setSummaryLoading] = React.useState(false);
  const [dau, setDau] = React.useState<SummaryValue | undefined>();
  const [wau, setWau] = React.useState<SummaryValue | undefined>();
  const [mau, setMau] = React.useState<SummaryValue | undefined>();
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const startISO = new Date(dStart + 'T00:00:00Z').toISOString();
        const endISO = new Date(dEnd + 'T23:59:59Z').toISOString();
        const resp = await fetchUsersActivity({
          granularity: dGranularity,
          start: startISO,
          end: endISO,
          role: dRole,
          department: dDepartment || undefined,
          status: dStatus || undefined,
          organization_id: dOrg || undefined,
        });
        if (!mounted) return;
        const mapped = (resp.buckets || []).map((b) => ({
          date: b.bucketStart.slice(0, 10),
          total: b.total,
          admin: b.admin,
          user: b.user,
        }));
        setSeries(mapped);
      } catch (e: any) {
        setError(e?.message || 'Failed to load activity');
        setSeries([]);
      } finally {
        setLoading(false);
      }
    }
    run();
    return () => {
      mounted = false;
    };
  }, [dGranularity, dRole, dDepartment, dStatus, dStart, dEnd, dOrg]);

  React.useEffect(() => {
    let mounted = true;
    async function run() {
      setSummaryLoading(true);
      try {
        const s = await fetchUsersSummary(30);
        if (!mounted) return;
        setDau(s.dau);
        setWau(s.wau);
        setMau(s.mau);
      } catch (_e) {
        // noop; keep old summary if fails
      } finally {
        setSummaryLoading(false);
      }
    }
    run();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ margin: '0 0 12px 0', color: '#111827' }}>Users Analytics</h2>
      <UsersSummaryCards dau={dau} wau={wau} mau={mau} loading={summaryLoading} />
      <div
        style={{
          marginTop: 16,
          background: '#fff',
          borderRadius: 8,
          padding: 12,
          boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        }}
      >
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <div>
            <label style={{ fontSize: 12, color: '#6B7280' }}>Granularity</label>
            <select
              value={granularity}
              onChange={(e) => setGranularity(e.target.value as Granularity)}
              style={{ display: 'block', padding: 8, borderRadius: 6, border: '1px solid #e5e7eb' }}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, color: '#6B7280' }}>Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as RoleFilter)}
              style={{ display: 'block', padding: 8, borderRadius: 6, border: '1px solid #e5e7eb' }}
            >
              <option value="all">All</option>
              <option value="admin">Admin</option>
              <option value="user">User</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, color: '#6B7280' }}>Department</label>
            <input
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="e.g., Sales"
              style={{ display: 'block', padding: 8, borderRadius: 6, border: '1px solid #e5e7eb' }}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, color: '#6B7280' }}>Status</label>
            <input
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder="active"
              style={{ display: 'block', padding: 8, borderRadius: 6, border: '1px solid #e5e7eb' }}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, color: '#6B7280' }}>Start</label>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              style={{ display: 'block', padding: 8, borderRadius: 6, border: '1px solid #e5e7eb' }}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, color: '#6B7280' }}>End</label>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              style={{ display: 'block', padding: 8, borderRadius: 6, border: '1px solid #e5e7eb' }}
            />
          </div>

          <div>
            <label style={{ fontSize: 12, color: '#6B7280' }}>Organization</label>
            <input
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
              placeholder="tenant/org id"
              style={{ display: 'block', padding: 8, borderRadius: 6, border: '1px solid #e5e7eb' }}
            />
          </div>
        </div>

        {error && (
          <div style={{ color: '#EF4444', marginBottom: 8 }}>
            {error}
          </div>
        )}

        <UsersActivityChart data={series} loading={loading} />
      </div>
    </div>
  );
};

export default UsersAnalyticsPanel;
