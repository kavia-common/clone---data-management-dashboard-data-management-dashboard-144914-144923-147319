import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { getUsers } from '../../services/usersService';
import Card from '../common/Card';
import Skeleton from '../ui/Skeleton';
import { getStatusColor } from '../../utils/statusColors';

/**
 * PUBLIC_INTERFACE
 * MostActiveUsersChart
 * A horizontal bar chart showing the most recently active users based on updated_at from /api/users.
 * - Defaults to status=active (filter) and sort=-updated_at
 * - Controls: Top N selector (5/10/20), toggle to include all statuses
 * - When including all, bars are color-coded by user.status using theme/status colors
 */
function MostActiveUsersChart({ defaultTopN = 10, className = '' }) {
  const [topN, setTopN] = useState(defaultTopN);
  const [includeAll, setIncludeAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);
  // Use CSS variables defined by the app theme with fallbacks

  // Fetch users from existing service with appropriate filters and sorting.
  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // We will request a sufficiently large page to cover Top 20 when filtered
        // Using server-side sort=-updated_at, and filter status unless includeAll is true
        const params = {
          page: 1,
          limit: 200,
          sort: '-updated_at',
        };

        if (!includeAll) {
          params.filter = JSON.stringify({ status: 'active' });
        }

        const res = await getUsers(params);
        // getUsers may return either { success, data, meta } or a raw array
        const list = Array.isArray(res) ? res : (res?.data || []);
        // Normalize: ensure updated_at is parsed; keep only items with updated_at present
        const normalized = list
          .filter(u => u && (u.updated_at || u.updatedAt || u.last_updated))
          .map(u => ({
            id: u._id || u.id,
            name: u.name || u.full_name || null,
            email: u.email || u.user_email || null,
            status: u.status || 'unknown',
            updatedAt:
              u.updated_at ||
              u.updatedAt ||
              u.last_updated ||
              u.lastUpdated ||
              null,
          }))
          .filter(u => !!u.updatedAt);

        if (mounted) {
          setUsers(normalized);
        }
      } catch (e) {
        if (mounted) {
          setError(e?.message || 'Failed to load users');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [includeAll]);

  // Compute Top N sorted by updatedAt DESC (most recent first)
  const topUsers = useMemo(() => {
    const sorted = [...users].sort((a, b) => {
      const ta = new Date(a.updatedAt).getTime();
      const tb = new Date(b.updatedAt).getTime();
      return tb - ta;
    });
    return sorted.slice(0, topN);
  }, [users, topN]);

  // Chart colors
  const barColor = 'var(--color-primary, #2563EB)';
  const bgColor = 'var(--color-surface, #ffffff)';
  const textColor = 'var(--color-text, #111827)';
  const gridColor = 'var(--chart-grid, #e5e7eb)';

  const formatDisplay = (u) => u.name || u.email || u.id || 'Unknown';
  const formatDate = (iso) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return iso;
    }
  };

  // Simple inline horizontal bar chart rendering that follows existing CSS approach
  return (
    <Card className={className}>
      <div className="chart-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0, color: textColor }}>Most Active Users</h3>
          <p style={{ margin: 0, color: '#6b7280', fontSize: 12 }}>
            Ranked by most recent updated_at from Users collection
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <label style={{ fontSize: 12, color: '#6b7280' }}>
            Top:&nbsp;
            <select
              aria-label="Top N"
              value={topN}
              onChange={(e) => setTopN(Number(e.target.value))}
              style={{
                padding: '6px 8px',
                borderRadius: 6,
                border: '1px solid #e5e7eb',
                background: bgColor,
                color: textColor,
                fontSize: 12,
              }}
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
            </select>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6b7280' }}>
            <input
              type="checkbox"
              checked={includeAll}
              onChange={(e) => setIncludeAll(e.target.checked)}
            />
            Include all statuses
          </label>
        </div>
      </div>

      {loading ? (
        <Skeleton height={180} />
      ) : error ? (
        <div style={{ color: 'var(--color-error, #EF4444)', fontSize: 14 }}>{error}</div>
      ) : topUsers.length === 0 ? (
        <div style={{ color: '#6b7280', fontSize: 14 }}>No users found.</div>
      ) : (
        <div className="horizontal-bar-chart" style={{ width: '100%', overflowX: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr 160px', gap: 8, padding: '8px 0', borderBottom: `1px solid ${gridColor}`, fontSize: 12, color: '#6b7280' }}>
            <div>User</div>
            <div>Recency</div>
            <div style={{ textAlign: 'right' }}>Updated at</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
            {topUsers.map((u, idx) => {
              // Map updatedAt into a recency score; latest gets 100%, others relative
              const maxTs = new Date(topUsers[0].updatedAt).getTime();
              const minTs = new Date(topUsers[topUsers.length - 1].updatedAt).getTime();
              const rng = Math.max(1, maxTs - minTs);
              const cur = new Date(u.updatedAt).getTime();
              const ratio = Math.max(0.05, (cur - minTs) / rng); // small minimum so smallest still visible

              const color = includeAll
                ? (getStatusColor?.(u.status) || barColor)
                : barColor;

              return (
                <div
                  key={`${u.id}-${idx}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '240px 1fr 160px',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        width: 20,
                        textAlign: 'right',
                        color: '#6b7280',
                        fontSize: 12,
                      }}
                    >
                      {idx + 1}.
                    </span>
                    <span style={{ color: textColor, fontWeight: 500 }}>
                      {formatDisplay(u)}
                    </span>
                    {includeAll && (
                      <span
                        style={{
                          marginLeft: 8,
                          padding: '2px 6px',
                          borderRadius: 999,
                          background: '#f3f4f6',
                          color: '#6b7280',
                          fontSize: 10,
                          textTransform: 'uppercase',
                        }}
                      >
                        {u.status}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      position: 'relative',
                      height: 16,
                      background: '#f3f4f6',
                      borderRadius: 8,
                      overflow: 'hidden',
                    }}
                    aria-label={`Recency bar for ${formatDisplay(u)}`}
                  >
                    <div
                      style={{
                        width: `${Math.round(ratio * 100)}%`,
                        height: '100%',
                        background: color,
                        transition: 'width 300ms ease',
                      }}
                    />
                  </div>
                  <div style={{ textAlign: 'right', color: '#6b7280', fontSize: 12 }}>
                    {formatDate(u.updatedAt)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

MostActiveUsersChart.propTypes = {
  defaultTopN: PropTypes.number,
  className: PropTypes.string,
};

export default MostActiveUsersChart;
