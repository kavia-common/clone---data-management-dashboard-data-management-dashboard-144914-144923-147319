import React, { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import { getUserById } from '../../api/users';

/**
 * PUBLIC_INTERFACE
 * SessionDetailsModal
 * A responsive, accessible modal that presents session details in a clean two-column layout aligned to the Ocean Professional theme.
 *
 * Props:
 * - open: boolean - controls visibility
 * - onClose: function - invoked to close modal
 * - session: object - session data to render
 *
 * Design and UX:
 * - Uses parent Modal overlay; keeps sticky header within card with subtle shadow
 * - Two-column responsive grid (minmax 240px, 1fr) stacking to single column <640px
 * - Labels are muted, medium weight; values wrap and avoid horizontal scroll
 * - Full-width red Close button with hover/focus states, rounded-md
 * - No metadata section
 */
function SessionDetailsModal({ open, onClose, session }) {
  const headerId = 'session-details-title';
  const contentRef = useRef(null);

  // Local state for resolved user name
  const [userName, setUserName] = useState('');
  const [userLoading, setUserLoading] = useState(false);

  // Derive userId from session using common keys
  const userId = useMemo(() => {
    if (!session || typeof session !== 'object') return '';
    return (
      session.userId ||
      session.user_id ||
      (typeof session.user === 'object' ? session.user?.id || session.user?._id : session.user) ||
      session.user ||
      ''
    );
  }, [session]);

  // Non-blocking fetch of user details with caching in API helper
  useEffect(() => {
    let cancelled = false;

    async function resolveUser() {
      if (!userId) {
        setUserName('');
        setUserLoading(false);
        return;
      }
      setUserLoading(true);
      try {
        const user = await getUserById(String(userId));
        if (cancelled) return;

        const name =
          user?.name ||
          user?.full_name ||
          [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() ||
          user?.email ||
          '';

        setUserName(name || 'Unknown User');
      } catch (e) {
        if (!cancelled) setUserName('Unknown User');
      } finally {
        if (!cancelled) setUserLoading(false);
      }
    }

    resolveUser();
    return () => {
      cancelled = true;
    };
  }, [userId]);

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
      if (isNaN(d.getTime())) return String(val);
      return d.toLocaleString();
    } catch {
      return String(val);
    }
  };

  // PUBLIC_INTERFACE
  const computeDuration = (start, end) => {
    /** Compute human-readable duration given start and end timestamps (ms or ISO). */
    if (!start || !end) return '—';
    try {
      const s = new Date(start).getTime();
      const e = new Date(end).getTime();
      if (isNaN(s) || isNaN(e)) return '—';
      let ms = Math.max(0, e - s);
      const secs = Math.floor(ms / 1000);
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const sRem = secs % 60;
      const parts = [];
      if (h) parts.push(`${h}h`);
      if (m || h) parts.push(`${m}m`);
      parts.push(`${sRem}s`);
      return parts.join(' ');
    } catch {
      return '—';
    }
  };

  // Collect required details only; hide disallowed fields.
  const coreDetails = useMemo(() => {
    if (!session || typeof session !== 'object') return {};

    const s = session;
    const get = (keys) => {
      for (const k of keys) {
        if (s && s[k] !== undefined && s[k] !== null) return s[k];
      }
      return undefined;
    };

    const startedAt = get(['startedAt', 'start_time', 'startTime', 'created_at', 'createdAt']);
    const lastUpdatedAt = get(['lastUpdatedAt', 'updatedAt', 'updated_at', 'end_time', 'endTime']);
    const sessionId = get(['sessionId', '_id', 'id']);
    const user = get(['user', 'userId', 'user_id', 'username', 'user_name', 'email']);
    const project = get(['project', 'projectId', 'project_id']);
    const tenant = get(['tenant', 'tenantId', 'tenant_id']);

    const durationStr = computeDuration(startedAt, lastUpdatedAt);

    // Only include the approved labels and order
    // Use resolved userName; if loading show subtle hint; fallback to Unknown User
    const displayUser =
      (userName && userName.trim()) ||
      (userLoading ? 'Loading…' : 'Unknown User');

    return {
      User: displayUser,
      'Session ID': sessionId ?? '—',
      Project: project ?? '—',
      Tenant: tenant ?? '—',
      'Started At': formatDate(startedAt),
      'Last Updated At': formatDate(lastUpdatedAt),
      Duration: durationStr,
    };
  }, [session, userName, userLoading]);

  // Title must be "Session Details - <sessionId>"
  const title = useMemo(() => {
    const id = session?.sessionId || session?._id || session?.id || '';
    return `Session Details - ${id || '—'}`;
  }, [session]);

  return (
    <Modal open={open} onClose={onClose} title={title}>
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
          aria-label="Core details"
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
            {Object.entries(coreDetails).map(([label, value]) => {
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
                    {String(value)}
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
