import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';

// Prefer existing UI primitives if available
import Modal from '../ui/Modal.jsx';
import Tabs from '../ui/Tabs.jsx';

// Views
import { useUserProjects } from '../../hooks/useUserProjects';

/**
 * Internal presentational view for user details
 * 2x2 responsive grid with Ocean Professional styling and neutral divider.
 * Fields: Name | Email (row 1), Role | Tenant (row 2).
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
        padding: 24, // comfortable padding
        // neutral subtle divider instead of colored accent to avoid unintended lines
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

        {/* Role */}
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
            Role
          </span>
          <div
            style={{
              margin: 0,
              color: "var(--text-primary, #111827)",
              fontWeight: 600,
              wordBreak: "break-word",
            }}
            title={role || undefined}
          >
            {role || "—"}
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
 * Wraps lists/tables with horizontal scrolling when needed.
 * Fits the new padding and scrollable panel constraints.
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

  // Small presentational component to render each project card
  const ProjectCard = ({ project }) => {
    const id = project?.project_id || project?.projectId || project?._id || project?.id || '—';
    const name =
      project?.name ||
      project?.project_name ||
      project?.projectName ||
      '—';
    const status = project?.status || project?.state || '';
    const desc = project?.description || project?.project_description || '';
    const created = project?.createdAt || project?.created_at || '';
    const updated = project?.updatedAt || project?.updated_at || '';
    const last = project?.last_activity || project?.lastActivity || updated || created || '';

    const safeDate = (val) => {
      if (!val) return '—';
      try { return new Date(val).toLocaleString(); } catch { return String(val); }
    };

    // Card styles matching Ocean Professional theme
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
      gridTemplateColumns: '220px 1fr', // left fixed, right flexible
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
        onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow, 0 1px 2px rgba(16,24,40,0.04))'; }}
        onMouseDown={(e) => { e.currentTarget.style.transform = 'translateY(1px)'; }}
        onMouseUp={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
        onFocus={(e) => { e.currentTarget.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.28)'; }}
        onBlur={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow, 0 1px 2px rgba(16,24,40,0.04))'; }}
      >
        {/* Responsive two-column layout: switch to 1-col on small screens via inline match */}
        <div
          style={window?.matchMedia && window.matchMedia('(max-width: 640px)').matches ? gridStyleMobile : gridStyle}
        >
          {/* Left column: Project ID pill with label */}
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--text-tertiary, #64748B)',
                letterSpacing: '.02em',
                marginBottom: 6,
                textTransform: 'none',
              }}
            >
              Project ID
            </div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: '#F8FAFC',
                color: 'var(--text-primary, #111827)',
                border: '1px solid var(--border-subtle, #E6EAF0)',
                borderRadius: 9999,
                padding: '6px 10px',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                fontWeight: 600,
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={String(id)}
              aria-label={`Project ID ${id}`}
            >
              {String(id)}
            </div>
          </div>

          {/* Right column: key fields as labeled rows */}
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'max-content 1fr',
              rowGap: 8,
              columnGap: 12,
              alignItems: 'center',
              minWidth: 0,
            }}
          >
            {status ? (
              <>
                <dt style={{ fontSize: 12, color: 'var(--text-tertiary, #64748B)', fontWeight: 600 }}>Status</dt>
                <dd style={{ margin: 0 }}>
                  <span className="status-badge" aria-label={`Status ${status}`}>{String(status)}</span>
                </dd>
              </>
            ) : null}

            {desc ? (
              <>
                <dt style={{ fontSize: 12, color: 'var(--text-tertiary, #64748B)', fontWeight: 600 }}>Description</dt>
                <dd
                  style={{
                    margin: 0,
                    color: 'var(--text-secondary, #475569)',
                    whiteSpace: 'normal',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {String(desc)}
                </dd>
              </>
            ) : null}

            {created ? (
              <>
                <dt style={{ fontSize: 12, color: 'var(--text-tertiary, #64748B)', fontWeight: 600 }}>Created</dt>
                <dd style={{ margin: 0, color: 'var(--text-secondary, #475569)' }}>{safeDate(created)}</dd>
              </>
            ) : null}

            {(updated || last) ? (
              <>
                <dt style={{ fontSize: 12, color: 'var(--text-tertiary, #64748B)', fontWeight: 600 }}>Updated</dt>
                <dd style={{ margin: 0, color: 'var(--text-secondary, #475569)' }}>
                  {safeDate(updated || last)}
                </dd>
              </>
            ) : null}
          </dl>
        </div>
      </div>
    );
  };

  return (
    <div role="list" aria-label="User projects list" style={{ display: 'grid', gap: 12 }}>
      {list.length === 0 && (
        <div
          className="table-empty"
          role="note"
          style={{ color: 'var(--text-tertiary)', background: 'transparent' }}
        >
          No projects found for this user.
        </div>
      )}

      {/* Scroll safety is provided by the modal's content area; ensure min width for inner layout */}
      <div style={{ display: 'grid', gap: 12, minWidth: 320 }}>
        {list.map((p, idx) => {
          const key = p?.project_id || p?.projectId || p?._id || idx;
          return <ProjectCard key={key} project={p} />;
        })}
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
 * - Styled tabs with Ocean Professional colors and active underline (neutral)
 * - Sticky header and tab bar; scroll only the content
 * - Comfortable padding and full-width red Close button
 * - Semi-transparent backdrop to focus attention
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

  // Tabs with theme-aware labels
  const tabs = useMemo(
    () => [
      { key: 'details', label: 'Details' },
      { key: 'projects', label: 'Projects' },
    ],
    []
  );

  const title = useMemo(() => {
    if (!user) return 'User';
    return user?.name || user?.full_name || user?.email || 'User';
  }, [user]);

  // Custom tab renderer to apply requested theme (active/inactive/hover)
  function ThemedTabs({ activeKey, onChange }) {
    return (
      <div
        role="tablist"
        aria-label="User info tabs"
        style={{
          display: "flex",
          gap: 8,
          borderBottom: "1px solid var(--border-subtle)",
          paddingBottom: 4,
        }}
      >
        {tabs.map((t) => {
          const isActive = String(activeKey) === String(t.key);
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(t.key)}
              title={t.label}
              style={{
                appearance: "none",
                border: "none",
                background: isActive ? "rgba(15, 23, 42, 0.04)" : "transparent", // neutral subtle tint
                color: isActive ? "var(--text-primary, #111827)" : "var(--text-secondary, #475569)",
                fontWeight: isActive ? 700 : 600,
                padding: "8px 12px",
                borderRadius: 8,
                cursor: "pointer",
                outline: "none",
                position: "relative",
                transition: "background .15s ease, color .15s ease",
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = "rgba(15,23,42,0.05)";
                e.currentTarget.style.color = "var(--text-primary, #111827)";
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = isActive ? "var(--text-primary, #111827)" : "var(--text-secondary, #475569)";
              }}
            >
              {t.label}
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: 8,
                  right: 8,
                  bottom: -5,
                  height: 2,
                  background: isActive ? "var(--border-subtle, #E5E7EB)" : "transparent",
                  borderRadius: 2,
                  transition: "background .15s ease",
                }}
              />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <Modal title={title} open={open} onClose={onClose}>
      {/* Wrapper to narrow only this user modal without affecting global Modal */}
      <div
        className="tabbed-user-modal--narrow"
        style={{
          width: "100%",
          maxWidth: "720px", // narrower width per request
          margin: "0 auto", // keep centered within Modal content area
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <style>{`
          /* Ensure narrow container adapts on extra small screens without horizontal overflow */
          @media (max-width: 740px) {
            .tabbed-user-modal--narrow {
              max-width: 100%;
            }
          }
        `}</style>
        <style>{`
          /* Ensure narrow container adapts on extra small screens without horizontal overflow */
          @media (max-width: 740px) {
            .tabbed-user-modal--narrow {
              max-width: 100%;
            }
          }
        `}</style>
        {/* Sticky tabs header inside modal content; body scrolls */}
        <div className="sticky-header" style={{ boxShadow: "0 1px 0 var(--border-subtle)", background: "#fff" }}>
          <div style={{ padding: "12px 20px" }}>
            <ThemedTabs activeKey={activeTab} onChange={setActiveTab} />
          </div>
        </div>

        {/* Scrollable body area */}
        <div role="region" aria-label="Tab content" style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#f9fafb" }} tabIndex={0}>
          <div style={{ padding: 20 }}>
            {activeTab === 'details' && (
              <div style={{ display: "grid", gap: 16 }}>
                <UserDetailsView user={user} />
              </div>
            )}

            {activeTab === 'projects' && (
              <div style={{ display: "grid", gap: 16 }}>
                <UserProjectsView userId={userId} tenantId={tenantId} from={from} to={to} />
              </div>
            )}
          </div>
        </div>

        {/* Footer action */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border-subtle)", background: "#fff" }}>
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
              boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
              transition: "background .15s ease, transform .05s ease",
            }}
            onMouseDown={(e) => { e.currentTarget.style.transform = "translateY(1px)"; }}
            onMouseUp={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#dc2626"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#EF4444"; }}
            onFocus={(e) => { e.currentTarget.style.outline = "3px solid rgba(239,68,68,0.35)"; e.currentTarget.style.outlineOffset = "2px"; }}
            onBlur={(e) => { e.currentTarget.style.outline = "none"; }}
            aria-label="Close"
            title="Close"
          >
            Close
          </button>
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
