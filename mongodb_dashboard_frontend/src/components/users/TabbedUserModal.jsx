import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';

// Prefer existing UI primitives if available
import Modal from '../ui/Modal.jsx';

// Views
import { useUserProjects } from '../../hooks/useUserProjects';

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
  if (loading) return <div className="table-empty">Loading projects…</div>;
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
        <div className="table-empty" style={{ color: 'var(--text-tertiary)' }}>
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

  return (
    <Modal title={title} open={open} onClose={onClose}>
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
        </div>
      </div>

      <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border-subtle)", background: "var(--bg-surface, #fff)" }}>
        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%",
            background: "#EF4444",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            padding: "10px 14px",
            fontWeight: 700,
            cursor: "pointer",
          }}
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
  defaultTab: PropTypes.oneOf(['details', 'projects']),
  from: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
  to: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
};
