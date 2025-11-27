import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';

// Prefer existing UI primitives if available
import Modal from '../ui/Modal.jsx';

// Views
import { useUserProjects } from '../../hooks/useUserProjects';

// Shared components/utilities
import DataTable from '../DataTable.jsx';
import LoadingState from '../common/LoadingState.jsx';
import ErrorState from '../common/ErrorState.jsx';
import { listSessions, listLlmCosts } from '../../api/baseClient';
import { formatUsdUpToSixDecimals } from '../../utils/formatCurrency';

/**
 * Internal presentational view for user details
 * 2x2 responsive grid with Ocean Professional styling and neutral divider.
 * Fields: Name | Email (row 1), Role | Tenant (row 2).
 */
function UserDetailsView({ user }) {
  if (!user) return <div className="text-gray-500">No user selected</div>;

  const name =
    user?.name ||
    user?.full_name ||
    `${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim() ||
    '';
  const email = user?.email || '';
  const department =
    user?.department ??
    user?.Department ??
    user?.dept ??
    user?.user?.department ??
    '';
  const tenant =
    user?.tenant_id ??
    user?.organization_name ??
    user?.organization ??
    user?.organization_id ??
    '';

  return (
    <section
      aria-label="User details"
      style={{
        background: "var(--bg-surface, #ffffff)",
        border: "1px solid var(--border-subtle, #E6EAF0)",
        borderRadius: 12,
        boxShadow: "var(--shadow, 0 1px 2px rgba(16,24,40,0.04))",
        padding: 24,
        borderLeft: "1px solid var(--border-subtle, #E5E7EB)",
      }}
    >
      <div
        role="group"
        aria-label="Details grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 16,
        }}
      >
        {/* Name */}
        <div>
          <span
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-tertiary, #64748B)",
              letterSpacing: ".02em",
              marginBottom: 6,
            }}
          >
            Name
          </span>
          <div
            style={{
              margin: 0,
              color: "var(--text-primary, #111827)",
              fontWeight: 600,
              wordBreak: "break-word",
            }}
            title={name || undefined}
          >
            {name || "—"}
          </div>
        </div>

        {/* Email */}
        <div>
          <span
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-tertiary, #64748B)",
              letterSpacing: ".02em",
              marginBottom: 6,
            }}
          >
            Email
          </span>
          <div
            style={{
              margin: 0,
              color: "var(--text-primary, #111827)",
              fontWeight: 600,
              wordBreak: "break-word",
            }}
            title={email || undefined}
          >
            {email || "—"}
          </div>
        </div>

        {/* Department */}
        <div>
          <span
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-tertiary, #64748B)",
              letterSpacing: ".02em",
              marginBottom: 6,
            }}
          >
            Department
          </span>
          <div
            style={{
              margin: 0,
              color: "var(--text-primary, #111827)",
              fontWeight: 600,
              wordBreak: "break-word",
            }}
            title={department || undefined}
          >
            {department || "—"}
          </div>
        </div>

        {/* Tenant */}
        <div>
          <span
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-tertiary, #64748B)",
              letterSpacing: ".02em",
              marginBottom: 6,
            }}
          >
            Tenant
          </span>
          <div
            style={{
              margin: 0,
              color: "var(--text-primary, #111827)",
              fontWeight: 600,
              wordBreak: "break-word",
            }}
            title={(tenant && String(tenant)) || undefined}
          >
            {tenant ? String(tenant) : "—"}
          </div>
        </div>
      </div>
    </section>
  );
}

UserDetailsView.propTypes = {
  user: PropTypes.object,
};

/**
 * Internal presentational view for user projects
 */
function UserProjectsView({ userId, tenantId, from, to }) {
  const enabled = Boolean(userId && tenantId);
  const { projects, loading, error, refetch } = useUserProjects({ userId, tenantId, from, to, enabled });

  if (!enabled) {
    return <div className="text-gray-500">Select a user with a valid tenant to view projects.</div>;
  }
  if (loading) return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: 'transparent',
        color: '#ffffff',
        border: 'none',
        boxShadow: 'none',
        textAlign: 'center',
        padding: 12,
        borderRadius: 8,
      }}
    >
      Loading projects…
    </div>
  );
  if (error) {
    return (
      <div className="error" role="alert" style={{ marginBottom: 12 }}>
        {error}{' '}
        <button
          onClick={() => refetch()}
          className="btn btn-ghost"
          style={{ height: 28, padding: '2px 8px' }}
        >
          Retry
        </button>
      </div>
    );
  }

  const list = projects || [];

  const ProjectCard = ({ project }) => {
    const id = project?.project_id || project?.projectId || project?._id || project?.id || '—';
    const name = project?.name || project?.project_name || project?.projectName || '—';
    const status = project?.status || project?.state || '';
    const desc = project?.description || project?.project_description || '';
    const created = project?.createdAt || project?.created_at || '';
    const updated = project?.updatedAt || project?.updated_at || '';
    const last = project?.last_activity || project?.lastActivity || updated || created || '';

    const safeDate = (val) => {
      if (!val) return '—';
      try { return new Date(val).toLocaleString(); } catch { return String(val); }
    };

    const cardStyle = {
      background: 'var(--bg-surface, #ffffff)',
      border: '1px solid var(--border-subtle, #e5e7eb)',
      borderRadius: 12,
      boxShadow: 'var(--shadow, 0 1px 2px rgba(16,24,40,0.04))',
      padding: 16,
      transition: 'box-shadow .2s ease, transform .06s ease',
    };

    const gridStyle = {
      display: 'grid',
      gridTemplateColumns: '220px 1fr',
      gap: 16,
    };

    const gridStyleMobile = {
      display: 'grid',
      gridTemplateColumns: '1fr',
      gap: 12,
    };

    return (
      <div
        role="article"
        aria-label={`Project ${id}`}
        tabIndex={0}
        style={cardStyle}
      >
        <div
          style={window?.matchMedia && window.matchMedia('(max-width: 640px)').matches ? gridStyleMobile : gridStyle}
        >
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--text-tertiary, #64748B)',
                letterSpacing: '.02em',
                marginBottom: 6,
              }}
            >
              Project ID
            </div>
            <div
              title={String(id)}
              style={{
                margin: 0,
                color: 'var(--text-primary, #111827)',
                fontWeight: 600,
                wordBreak: 'break-word',
              }}
            >
              {String(id)}
            </div>
          </div>

          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'max-content 1fr',
              rowGap: 8,
              columnGap: 12,
              alignItems: 'center',
            }}
          >
            {status && (
              <>
                <dt style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 600 }}>Status</dt>
                <dd style={{ margin: 0 }}>{String(status)}</dd>
              </>
            )}

            {desc && (
              <>
                <dt style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 600 }}>Description</dt>
                <dd style={{ margin: 0, color: 'var(--text-secondary)' }}>{String(desc)}</dd>
              </>
            )}

            {created && (
              <>
                <dt style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 600 }}>Created</dt>
                <dd style={{ margin: 0, color: 'var(--text-secondary)' }}>{safeDate(created)}</dd>
              </>
            )}

            {(updated || last) && (
              <>
                <dt style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 600 }}>Updated</dt>
                <dd style={{ margin: 0, color: 'var(--text-secondary)' }}>{safeDate(updated || last)}</dd>
              </>
            )}
          </dl>
        </div>
      </div>
    );
  };

  return (
    <div role="list" aria-label="User projects list" style={{ display: 'grid', gap: 12 }}>
      {list.length === 0 && (
        <div
          style={{
            background: 'transparent',
            color: '#ffffff',
            border: 'none',
            boxShadow: 'none',
            textAlign: 'center',
            padding: 12,
            borderRadius: 8,
          }}
        >
          No projects found for this user.
        </div>
      )}
      <div style={{ display: 'grid', gap: 12, minWidth: 320 }}>
        {list.map((p, idx) => (
          <ProjectCard key={p?.project_id || p?._id || idx} project={p} />
        ))}
      </div>
    </div>
  );
}

UserProjectsView.propTypes = {
  userId: PropTypes.string,
  tenantId: PropTypes.string,
  from: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
  to: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
};

/**
 * PUBLIC_INTERFACE
 * TabbedUserModal
 */
export default function TabbedUserModal({
  open,
  onClose,
  user,
  tenantId,
  defaultTab = 'details',
  from,
  to,
}) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  useEffect(() => {
    if (open) setActiveTab(defaultTab);
  }, [open, defaultTab]);

  const userId = useMemo(() => user?._id || user?.id || '', [user]);

  const tabs = useMemo(
    () => [
      { key: 'details', label: 'User Details' },
      { key: 'projects', label: 'Project Details' },
      { key: 'sessions', label: 'Session Details' },
      { key: 'credits', label: 'Credits Consumed' },
    ],
    []
  );

  const title = useMemo(() => user?.name || user?.full_name || user?.email || 'User', [user]);

  function ThemedTabs({ activeKey, onChange }) {
    return (
      <div role="tablist" style={{ display: "flex", gap: 8, borderBottom: "1px solid var(--border-subtle)" }}>
        {tabs.map((t) => {
          const isActive = String(activeKey) === String(t.key);
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(t.key)}
              style={{
                appearance: "none",
                border: "none",
                background: isActive ? "rgba(15,23,42,0.04)" : "transparent",
                color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                fontWeight: isActive ? 700 : 600,
                padding: "8px 12px",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    );
  }

  // Session Details Tab
  function SessionDetailsTab({ userId }) {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function load() {
      if (!userId) return;
      setLoading(true);
      setError('');
      try {
        // Backend accepts pagination optionally. Use a reasonable page size.
        const res = await listSessions({ page: 1, limit: 50, sort: '-last_updated' });
        // Filter client-side by user_id as requested path requires user_id=<ID>
        // If backend already supports user_id query, we still filter defensively.
        const arr = Array.isArray(res?.items) ? res.items : [];
        const normalizedUserId = String(userId);
        const filtered = arr.filter((row) => {
          const uid =
            row?.user_id ??
            row?.userId ??
            row?.user?.id ??
            row?.user?._id ??
            row?.user?._source?.id ??
            row?.user?.user_id;
          return uid && String(uid) === normalizedUserId;
        });
        setItems(filtered);
      } catch (e) {
        setItems([]);
        setError(e?.message || 'Failed to load sessions.');
      } finally {
        setLoading(false);
      }
    }

    useEffect(() => {
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

    const columns = [
      { key: 'sessionId', label: 'Session ID', render: (v, row) => row?.session_id || row?.id || row?._id || '—', priority: 1 },
      { key: 'startedAt', label: 'Started At', render: (v, row) => {
          const d = row?.session_start || row?.startedAt || row?.created_at;
          try { return d ? new Date(d).toLocaleString() : '—'; } catch { return d || '—'; }
        }, priority: 2 },
      { key: 'lastActiveAt', label: 'Last Active', render: (v, row) => {
          const d = row?.last_updated || row?.lastActiveAt || row?.updated_at || row?.ended_at;
          try { return d ? new Date(d).toLocaleString() : '—'; } catch { return d || '—'; }
        }, priority: 2 },
      { key: 'ip', label: 'IP', render: (v, row) => row?.ip || row?.client_ip || row?.session_data?.ip || '—', priority: 3 },
      { key: 'device', label: 'Device', render: (v, row) => row?.device || row?.session_data?.device || '—', priority: 3 },
      { key: 'browser', label: 'Browser', render: (v, row) => row?.browser || row?.session_data?.browser || '—', priority: 3 },
      { key: 'location', label: 'Location', render: (v, row) => {
          const loc = row?.location || row?.session_data?.location || row?.geo;
          if (!loc) return '—';
          if (typeof loc === 'string') return loc;
          const city = loc.city || loc.town || '';
          const country = loc.country || loc.country_name || '';
          const parts = [city, country].filter(Boolean);
          return parts.length ? parts.join(', ') : '—';
        }, priority: 3 },
      { key: 'status', label: 'Status', render: (v, row) => row?.status || '—', priority: 2 },
    ];

    return (
      <div data-testid="session-details-tab">
        {loading && <LoadingState message="Loading sessions..." height={160} />}
        {!loading && error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && (
          items && items.length > 0 ? (
            <DataTable
              columns={columns}
              data={items}
              loading={false}
              pageSize={10}
              initialPage={1}
              paginationTitle="Sessions pages"
              maxBodyHeight={360}
              forceHorizontalScroll
            />
          ) : (
            <div className="table-empty">No sessions found for this user.</div>
          )
        )}
      </div>
    );
  }
  SessionDetailsTab.propTypes = { userId: PropTypes.string };

  // Credits Consumed Tab
  function CreditsConsumedTab({ userId }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function load() {
      if (!userId) return;
      setLoading(true);
      setError('');
      try {
        // Fetch costs and filter by user_id if needed
        const res = await listLlmCosts({ page: 1, limit: 100, sort: '-timestamp' });
        let items = Array.isArray(res?.items) ? res.items : [];
        const normalizedUserId = String(userId);
        items = items.filter((row) => {
          const uid =
            row?.user_id ??
            row?.userId ??
            row?.user?.id ??
            row?.user?._id ??
            row?.user?.user_id;
          return uid && String(uid) === normalizedUserId;
        });
        setRows(items);
      } catch (e) {
        setRows([]);
        setError(e?.message || 'Failed to load credits consumed.');
      } finally {
        setLoading(false);
      }
    }

    useEffect(() => {
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

    // compute total cost
    const totalCost = useMemo(() => {
      return (rows || []).reduce((acc, r) => {
        // prefer numeric fields; strip strings like "$1.23"
        const raw = r?.running_total ?? r?.total_cost ?? r?.cost ?? r?.amount ?? 0;
        const num = typeof raw === 'number' ? raw : Number(String(raw).replace(/[$,]/g, ''));
        return acc + (Number.isFinite(num) ? num : 0);
      }, 0);
    }, [rows]);

    const columns = [
      { key: 'timestamp', label: 'Timestamp', render: (v, row) => {
          const d = row?.timestamp || row?.date || row?.created_at;
          try { return d ? new Date(d).toLocaleString() : '—'; } catch { return d || '—'; }
        }, priority: 1 },
      { key: 'model', label: 'Model', render: (v, row) => row?.model || row?.llm_model || '—', priority: 2 },
      { key: 'operation', label: 'Operation', render: (v, row) => row?.operation || row?.type || row?.action || '—', priority: 2 },
      { key: 'tokens_in', label: 'Tokens In', render: (v, row) => {
          const n = row?.tokens_in ?? row?.prompt_tokens ?? row?.input_tokens;
          return Number.isFinite(Number(n)) ? Number(n).toLocaleString() : '—';
        }, priority: 3 },
      { key: 'tokens_out', label: 'Tokens Out', render: (v, row) => {
          const n = row?.tokens_out ?? row?.completion_tokens ?? row?.output_tokens;
          return Number.isFinite(Number(n)) ? Number(n).toLocaleString() : '—';
        }, priority: 3 },
      { key: 'cost', label: 'Cost', render: (v, row) => {
          const raw = row?.cost ?? row?.amount ?? row?.total_cost;
          const num = typeof raw === 'number' ? raw : Number(String(raw).replace(/[$,]/g, ''));
          return Number.isFinite(num) ? formatUsdUpToSixDecimals(num) : '—';
        }, priority: 1 },
      { key: 'currency', label: 'Currency', render: (v, row) => row?.currency || 'USD', priority: 3 },
      { key: 'running_total', label: 'Running Total', render: (v, row) => {
          const raw = row?.running_total ?? row?.cumulative_cost;
          const num = typeof raw === 'number' ? raw : Number(String(raw).replace(/[$,]/g, ''));
          return Number.isFinite(num) ? formatUsdUpToSixDecimals(num) : '—';
        }, priority: 2 },
    ];

    return (
      <div data-testid="credits-consumed-tab">
        {/* Summary header */}
        <div
          className="card"
          style={{
            marginBottom: 12,
            padding: 12,
            background: 'var(--bg-surface, #fff)',
            border: '1px solid var(--border-subtle,#e5e7eb)',
            borderRadius: 10,
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text-tertiary,#64748B)', fontWeight: 700, letterSpacing: '.02em' }}>
            Total Cost
          </div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {formatUsdUpToSixDecimals(totalCost)}
          </div>
        </div>

        {loading && <LoadingState message="Loading credits..." height={160} />}
        {!loading && error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && (
          rows && rows.length > 0 ? (
            <DataTable
              columns={columns}
              data={rows}
              loading={false}
              pageSize={10}
              initialPage={1}
              paginationTitle="Costs pages"
              maxBodyHeight={360}
              forceHorizontalScroll
            />
          ) : (
            <div className="table-empty">No cost records found for this user.</div>
          )
        )}
      </div>
    );
  }
  CreditsConsumedTab.propTypes = { userId: PropTypes.string };

  return (
    <Modal title={title} open={open} onClose={onClose} className="tabbed-user-modal">
      <div className="sticky-header" style={{ boxShadow: "0 1px 0 var(--border-subtle)", background: "var(--bg-surface, #fff)" }}>
        <div style={{ padding: "12px 20px" }}>
          <ThemedTabs activeKey={activeTab} onChange={setActiveTab} />
        </div>
      </div>

      <div role="region" style={{ flex: 1, overflow: "auto", background: "var(--bg-canvas, #f9fafb)" }}>
        <div style={{ padding: 20 }}>
          {activeTab === 'details' && <UserDetailsView user={user} />}
          {activeTab === 'projects' && (
            <UserProjectsView userId={userId} tenantId={tenantId} from={from} to={to} />
          )}
          {activeTab === 'sessions' && <SessionDetailsTab userId={userId} />}
          {activeTab === 'credits' && <CreditsConsumedTab userId={userId} />}
        </div>
      </div>

      <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border-subtle)", background: "var(--bg-surface, #fff)" }}>
        <button
          type="button"
          onClick={onClose}
          className="btn-modal-close"
          style={{ width: "100%", borderRadius: 10 }}
        >
          Close
        </button>
      </div>
    </Modal>
  );
}

TabbedUserModal.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  user: PropTypes.object,
  tenantId: PropTypes.string,
  defaultTab: PropTypes.oneOf(['details', 'projects', 'sessions', 'credits']),
  from: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
  to: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
};
