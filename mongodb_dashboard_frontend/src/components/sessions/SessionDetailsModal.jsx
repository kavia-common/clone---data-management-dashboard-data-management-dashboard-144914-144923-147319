import React, { useEffect, useMemo, useRef } from 'react';
import Modal from '../ui/Modal.jsx';

/**
 * PUBLIC_INTERFACE
 * SessionDetailsModal
 * A responsive, accessible modal that presents a focused set of session details in a clean two-column layout.
 *
 * Props:
 * - open: boolean - controls visibility
 * - onClose: function - invoked to close modal
 * - session: object - session data to render
 *
 * Shows exactly these fields:
 * - User (user.name or user.email fallback to userId/user)
 * - Session ID (id or _id)
 * - Project (project | projectId | project_name)
 * - Tenant (tenant | tenantId | tenant_name)
 * - Started At (createdAt | startedAt)
 * - Last Updated At (updatedAt | lastUpdatedAt)
 * - Duration (computed from Last Updated At - Started At)
 *
 * Design and UX:
 * - Uses parent Modal overlay; keeps sticky header within card with subtle shadow
 * - Two-column responsive grid stacking to single column <640px
 * - Labels are muted; values wrap and avoid horizontal scroll
 * - Full-width red Close button with hover/focus states
 * - Internal scroll with sticky header
 */
function SessionDetailsModal({ open, onClose, session }) {
  const headerId = 'session-details-title';
  const contentRef = useRef(null);

  // Focus modal content when opened for accessibility
  useEffect(() => {
    if (open && contentRef.current) {
      contentRef.current.focus();
    }
  }, [open]);

  // Helpers
  const formatDate = (val) => {
    if (!val) return '—';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleString();
    } catch {
      return '—';
    }
  };

  const formatDuration = (start, end) => {
    if (!start || !end) return '—';
    const s = new Date(start);
    const e = new Date(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return '—';
    const diffMs = Math.max(0, e.getTime() - s.getTime());
    const totalSeconds = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];
    if (hours) parts.push(`${hours}h`);
    if (minutes || hours) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(' ');
  };

  // Extract values with tolerant keys and fallbacks
  const sessionId =
    session?.id ?? session?._id ?? '—';

  const userDisplay =
    session?.user?.name ??
    session?.user?.email ??
    session?.userId ??
    (typeof session?.user === 'string' ? session.user : undefined) ??
    '—';

  const projectDisplay =
    session?.project ?? session?.projectId ?? session?.project_name ?? '—';

  const tenantDisplay =
    session?.tenant ?? session?.tenantId ?? session?.tenant_name ?? '—';

  const startedAtRaw =
    session?.createdAt ?? session?.startedAt ?? session?.start_time ?? session?.startTime;
  const lastUpdatedAtRaw =
    session?.updatedAt ?? session?.lastUpdatedAt ?? session?.end_time ?? session?.endTime;

  const startedAt = formatDate(startedAtRaw);
  const lastUpdatedAt = formatDate(lastUpdatedAtRaw);
  const duration = formatDuration(startedAtRaw, lastUpdatedAtRaw);

  // Only the requested fields in the 2-column grid
  const fields = useMemo(
    () => [
      { label: 'User', value: userDisplay },
      { label: 'Session ID', value: sessionId },
      { label: 'Project', value: projectDisplay },
      { label: 'Tenant', value: tenantDisplay },
      { label: 'Started At', value: startedAt },
      { label: 'Last Updated At', value: lastUpdatedAt },
      { label: 'Duration', value: duration },
    ],
    [userDisplay, sessionId, projectDisplay, tenantDisplay, startedAt, lastUpdatedAt, duration]
  );

  // Title format update
  const title = `Session Details - ${sessionId}`;

  return (
    <Modal open={open} onClose={onClose}>
      {/* Sticky Header with subtle shadow */}
      <div
        className="sticky-header"
        style={{
          zIndex: 1,
          background: 'rgba(255,255,255,0.96)',
          backdropFilter: 'saturate(1) blur(2px)',
          padding: '16px 24px',
          boxShadow: '0 1px 0 var(--border-subtle, #E5E7EB)',
        }}
      >
        <h2
          id={headerId}
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 600,
            color: 'var(--text-strong, #0F172A)',
          }}
          title={title}
          aria-label={title}
        >
          {title}
        </h2>
      </div>

      {/* Scrollable content area */}
      <div
        ref={contentRef}
        tabIndex={-1}
        id={`${headerId}-content`}
        style={{
          padding: '16px 24px',
          gap: 16,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'auto',
          WebkitOverflowScrolling: 'touch',
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
          flex: 1,
          minHeight: 0,
        }}
      >
        <section
          aria-label="Session details"
          className="details-card"
          style={{
            position: 'relative',
            background: '#fff',
            border: '1px solid var(--border-subtle, #E5E7EB)',
            borderRadius: 12,
            padding: 16,
          }}
        >
          <div
            role="group"
            aria-label="Label and value pairs"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              columnGap: 32,
              rowGap: 20,
            }}
          >
            {fields.map(({ label, value }) => {
              const isPlaceholder = value === '—';
              return (
                <div key={label} style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-muted, #475569)',
                      letterSpacing: '0.2px',
                      marginBottom: 6,
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: isPlaceholder ? 500 : 700,
                      color: isPlaceholder
                        ? 'var(--text-subtle, #94A3B8)'
                        : 'var(--text-strong, #0F172A)',
                      lineHeight: '20px',
                      whiteSpace: 'normal',
                      overflowWrap: 'anywhere',
                    }}
                    title={typeof value === 'string' ? value : undefined}
                  >
                    {String(value ?? '—')}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border-subtle, #E5E7EB)',
          background: '#ffffff',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          className="btn-close-primary"
          style={{
            width: '100%',
            height: 46,
            background: '#EF4444',
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            fontWeight: 700,
            boxShadow: '0 1px 2px rgba(16,24,40,0.04)',
            cursor: 'pointer',
            transition: 'background .15s ease, transform .06s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#DC2626'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#EF4444'; }}
          onMouseDown={(e) => { e.currentTarget.style.transform = 'translateY(1px)'; }}
          onMouseUp={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
          onFocus={(e) => { e.currentTarget.style.outline = '3px solid rgba(220,38,38,0.35)'; e.currentTarget.style.outlineOffset = '2px'; }}
          onBlur={(e) => { e.currentTarget.style.outline = 'none'; }}
          aria-label="Close"
          title="Close"
        >
          Close
        </button>
      </div>

      <style>{`
        @media (max-width: 639px) {
          .details-card [aria-label="Label and value pairs"] {
            grid-template-columns: 1fr !important;
            row-gap: 16px !important;
          }
        }
      `}</style>
    </Modal>
  );
}

export default SessionDetailsModal;
