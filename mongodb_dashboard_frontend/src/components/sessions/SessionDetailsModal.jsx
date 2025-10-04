import React, { useEffect, useMemo, useRef } from 'react';
import Modal from '../ui/Modal.jsx';
import { useDataContext } from '../../context/DataContext.jsx';
import { toCamelCaseName } from '../../utils/stringFormatters.js';

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
  const { users } = useDataContext?.() || { users: [] };

  // Focus modal content when opened for accessibility
  useEffect(() => {
    if (open && contentRef.current) {
      contentRef.current.focus();
    }
  }, [open]);

  // Helpers
  const formatDate = (val) => {
    // Render a formatted local date-time or an em-dash placeholder if missing/invalid.
    if (!val) return '—';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleString();
    } catch {
      return '—';
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

  // PUBLIC_INTERFACE
  const resolveUserName = (userRef) => {
    /**
     * Resolve a user-friendly name from user reference:
     * - If an object with name/displayName/fullName/email exists, pick appropriately
     * - If an id, search DataContext users for a matching _id/id/userId and prefer displayName/fullName/name/username/email
     */
    if (!userRef) return 'Unknown User';
    // If already a descriptive string (e.g., username/email)
    if (typeof userRef === 'string') {
      const candidate = users?.find?.(
        (u) => u?._id === userRef || u?.id === userRef || u?.userId === userRef
      );
      if (candidate) {
        return (
          candidate.displayName ||
          candidate.fullName ||
          candidate.name ||
          candidate.username ||
          candidate.email ||
          'Unknown User'
        );
      }
      return userRef || 'Unknown User';
    }
    if (typeof userRef === 'object') {
      // If the object has an id-like, try to match a richer record
      const candidateId = userRef._id || userRef.id || userRef.userId || userRef.user_id;
      if (candidateId) {
        const candidate = users?.find?.(
          (u) => u?._id === candidateId || u?.id === candidateId || u?.userId === candidateId
        );
        if (candidate) {
          return (
            candidate.displayName ||
            candidate.fullName ||
            candidate.name ||
            candidate.username ||
            candidate.email ||
            'Unknown User'
          );
        }
      }
      return (
        userRef.displayName ||
        userRef.fullName ||
        userRef.name ||
        userRef.username ||
        userRef.email ||
        userRef.user_name ||
        'Unknown User'
      );
    }
    return 'Unknown User';
  };

  // Collect required and requested details; preserve previously approved fields.
  const coreDetails = useMemo(() => {
    if (!session || typeof session !== 'object') return {};

    const s = session;

    // Utility: safely pick the first defined value by probing dot/flat aliases
    const pick = (keys) => {
      for (const k of keys) {
        if (k.includes('.')) {
          const parts = k.split('.');
          let cur = s;
          let found = true;
          for (const p of parts) {
            if (cur && Object.prototype.hasOwnProperty.call(cur, p)) {
              cur = cur[p];
            } else {
              found = false;
              break;
            }
          }
          if (found && cur != null) return cur;
        } else if (s && s[k] !== undefined && s[k] !== null) {
          return s[k];
        }
      }
      return undefined;
    };

    // Normalize created_at (startedAt aliases)
    const createdAtRaw = pick([
      'created_at', 'createdAt', 'startedAt', 'started_at', 'start_time', 'startTime', 'created', 'timestamp', 'session_start', 'sessionStart', 'begin_time', 'beginTime'
    ]);

    // Last Updated: prefer session.last_updated directly; only if absent, fall back to prior aliases
    const lastUpdatedPrimary = pick(['last_updated']);
    let normalizedLastUpdatedAt = lastUpdatedPrimary;
    if (!normalizedLastUpdatedAt) {
      normalizedLastUpdatedAt = pick([
        'updatedAt', 'updated_at',
        'modifiedAt', 'modified_at',
        'lastModified', 'last_modified',
        'lastActivityAt', 'last_activity_at',
        'finishedAt', 'finished_at',
        'endedAt', 'ended_at'
      ]);
    }

    const normalizedCreatedAt = createdAtRaw || undefined;

    const sessionId = pick(['sessionId', '_id', 'id']);

    // Strict user display: session.user_name first, then resolved user name, then Unknown
    const resolvedUserName = resolveUserName(pick(['user', 'userId', 'user_id', 'username', 'email', 'owner', 'ownerEmail']));
    // Normalize user name to camelCase for consistent display across sources
    const rawName = s?.User_name ?? resolvedUserName ?? 'Unknown User'; // Note: source uses 'User_name' (capital U)
    const displayUser = typeof rawName === 'string' ? toCamelCaseName(rawName) : rawName;

    const projectId = pick(['project_id', 'projectId', 'project', 'projectSlug']);
    const projectName = pick(['projectName', 'project_name', 'projectLabel', 'project_label']);
    const serviceType = pick(['serviceType', 'service_type', 'provider', 'modelProvider']);
    const tenant = pick(['tenant', 'tenantId', 'tenant_id', 'organization', 'organization_id', 'organizationId', 'tenantName', 'tenant_name']);

    // Compute duration using created_at and the normalized last_updated
    const durationStr = computeDuration(normalizedCreatedAt, normalizedLastUpdatedAt);

    // Dev-only diagnostics per instructions
    if (process.env.NODE_ENV !== 'production') {
      try {
        // eslint-disable-next-line no-console
        console.log('[SessionDetailsModal:debug]', {
          user_name: s?.user_name,
          user_id: s?.userId || s?.user_id,
          last_updated: s?.last_updated,
        });
      } catch {
        // ignore logging errors
      }
    }

    const details = {
      'User': displayUser,
      'Session ID': sessionId ?? '—',
      'Project ID': projectId ?? projectName ?? '—',
      'Service Type': serviceType ?? '—',
      Tenant: tenant ?? '—',
      'Created At': formatDate(normalizedCreatedAt),
      'Last Updated At': formatDate(normalizedLastUpdatedAt),
      Duration: durationStr,
    };

    return details;
  }, [session, users]);

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
              const isPlaceholder = value === '—' || value === 'Unknown User';
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
