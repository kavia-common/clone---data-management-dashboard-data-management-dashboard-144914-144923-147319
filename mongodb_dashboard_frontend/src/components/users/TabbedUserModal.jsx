import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';

// Prefer existing UI primitives if available
import Modal from '../ui/Modal.jsx';
import Tabs from '../ui/Tabs.jsx';

// Views
import { useUserProjects } from '../../hooks/useUserProjects';

/**
 * Internal presentational view for user details
 * Responsive grid, safe text wrapping and truncation.
 * Shows ONLY: Name, Email, Role, and Tenant in a 2x2 grid with Ocean Professional styling.
 */
function UserDetailsView({ user }) {
  if (!user) return <div className="text-gray-500">No user selected</div>;

  // Derive fields with fallbacks
  const name =
    user?.name ||
    user?.full_name ||
    `${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim() ||
    '';
  const email = user?.email || '';
  const role = user?.role || user?.user_role || '';
  const tenant =
    user?.tenant_id ??
    user?.organization_name ??
    user?.organization ??
    user?.organization_id ??
    '';

  // Card-like surface for details with theme-consistent styles
  return (
    <section
      aria-label="User details"
      style={{
        background: "var(--bg-surface, #ffffff)",
        border: "1px solid var(--border-subtle, #E6EAF0)",
        borderRadius: 12,
        boxShadow: "var(--shadow, 0 1px 2px rgba(16,24,40,0.04))",
        padding: 16,
      }}
    >
      <div
        className="grid grid-cols-1 sm:grid-cols-2 gap-4"
        role="group"
        aria-label="Details grid"
      >
        {/* Name */}
        <div>
          <label
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
          </label>
          <p
            style={{
              margin: 0,
              color: "var(--text-primary, #111827)",
              fontWeight: 600,
              wordBreak: "break-word",
            }}
            title={name || undefined}
          >
            {name || "—"}
          </p>
        </div>

        {/* Email */}
        <div>
          <label
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
          </label>
          <p
            style={{
              margin: 0,
              color: "var(--text-primary, #111827)",
              fontWeight: 600,
              wordBreak: "break-word",
            }}
            title={email || undefined}
          >
            {email || "—"}
          </p>
        </div>

        {/* Role */}
        <div>
          <label
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-tertiary, #64748B)",
              letterSpacing: ".02em",
              marginBottom: 6,
            }}
          >
            Role
          </label>
          <p
            style={{
              margin: 0,
              color: "var(--text-primary, #111827)",
              fontWeight: 600,
              wordBreak: "break-word",
            }}
            title={role || undefined}
          >
            {role || "—"}
          </p>
        </div>

        {/* Tenant */}
        <div>
          <label
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
          </label>
          <p
            style={{
              margin: 0,
              color: "var(--text-primary, #111827)",
              fontWeight: 600,
              wordBreak: "break-word",
            }}
            title={(tenant && String(tenant)) || undefined}
          >
            {tenant ? String(tenant) : "—"}
          </p>
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
 * Wraps lists/tables with horizontal scrolling when needed.
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
  return (
    <div className="space-y-4">
      {list.length === 0 && <div className="text-gray-500">No projects found.</div>}
      {/* Table/list wrapper with horizontal overflow safety */}
      <div style={{ overflowX: 'auto', overflowY: 'visible' }}>
        <div style={{ display: 'grid', gap: 12, minWidth: 360 }}>
          {list.map((p, idx) => {
            const key = p.project_id || p.projectId || idx;
            const name =
              p.name ||
              p.project_name ||
              p.projectName ||
              p.project_id ||
              p.projectId ||
              '—';
            const desc = p.description || p.project_description || '';
            const last = p.last_activity || p.lastActivity || null;
            return (
              <div
                key={key}
                className="border rounded p-3"
                style={{ background: '#fff' }}
              >
                <div
                  className="font-medium"
                  title={String(name)}
                  style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {name}
                </div>
                {desc ? (
                  <div
                    className="text-sm text-gray-600"
                    title={String(desc)}
                    style={{ marginTop: 4 }}
                  >
                    {desc}
                  </div>
                ) : null}
                {last ? (
                  <div
                    className="text-sm text-gray-500"
                    title={String(last)}
                    style={{ marginTop: 6, whiteSpace: 'nowrap' }}
                  >
                    Last activity: {(() => { try { return new Date(last).toLocaleString(); } catch { return String(last); } })()}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
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
 * A single modal that combines user details and user projects into two tabs.
 * Structure optimized to avoid content overlap:
 * - Modal body becomes a flex column container with max-height and overflow hidden
 * - Sticky tablist header
 * - Scrollable panels area with min-h-0 and overflow-y-auto
 */
// PUBLIC_INTERFACE
export default function TabbedUserModal({
  open,
  onClose,
  user,
  tenantId,
  defaultTab = 'details',
  from = undefined,
  to = undefined,
}) {
  // Keep internal tab state synced to defaultTab whenever the modal opens
  const [activeTab, setActiveTab] = useState(defaultTab);
  useEffect(() => {
    if (open) setActiveTab(defaultTab);
  }, [open, defaultTab]);

  const userId = useMemo(() => user?._id || user?.id || '', [user]);

  const tabs = useMemo(
    () => [
      { key: 'details', label: 'Details' },
      { key: 'projects', label: 'Projects' },
    ],
    []
  );

  const title = useMemo(() => {
    if (!user) return 'User';
    return user.name || user.full_name || user.email || 'User';
  }, [user]);

  return (
    <Modal
      title={title}
      open={open}
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      }
    >
      {/* Modal content container:
          - flex column
          - capped height to avoid viewport overflow
          - internal scroll only in the panels section
       */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxWidth: 900,
          maxHeight: '85vh',
          overflow: 'hidden',
          background: '#ffffff',
          borderRadius: 12,
        }}
      >
        {/* Tabs header: sticky inside this container, with safe z-index */}
        <div
          role="presentation"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            background: '#ffffff',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ padding: '12px 16px', overflowX: 'auto' }}>
            <Tabs
              tabs={tabs}
              activeKey={activeTab}
              onChange={setActiveTab}
              aria-label="User info tabs"
            />
          </div>
        </div>

        {/* Panels container: scrollable area */}
        <div
          role="region"
          aria-label="Tab content"
          style={{
            flex: 1,
            minHeight: 0, // critical for flex scroll
            overflowY: 'auto',
            overflowX: 'hidden',
            background: '#f9fafb',
            WebkitOverflowScrolling: 'touch',
          }}
          tabIndex={0} // allow keyboard scroll focus
        >
          <div style={{ padding: '16px' }}>
            {activeTab === 'details' && (
              <div className="space-y-4">
                <UserDetailsView user={user} />
              </div>
            )}

            {activeTab === 'projects' && (
              <div className="space-y-4">
                <UserProjectsView userId={userId} tenantId={tenantId} from={from} to={to} />
              </div>
            )}
          </div>
        </div>
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
