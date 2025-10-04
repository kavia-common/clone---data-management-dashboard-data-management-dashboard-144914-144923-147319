import React, { useEffect, useMemo, useRef } from 'react';
import Modal from '../ui/Modal.jsx';
import { useDataContext } from '../../context/DataContext.jsx';

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
        // support nested via simple dot path if ever provided
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

    // Last Updated: strict rule -> use session.last_updated if present, else fallbacks
    const lastUpdatedPrimary = pick(['last_updated']); // direct preferred field
    let normalizedLastUpdatedAt = lastUpdatedPrimary;
    if (!normalizedLastUpdatedAt) {
      // Only when missing, try aliases
      normalizedLastUpdatedAt = pick([
        'lastUpdatedAt', 'updatedAt', 'updated_at',
        'modifiedAt', 'modified_at',
        'lastModified', 'last_modified',
        'lastActivityAt', 'last_activity_at',
        'finishedAt', 'finished_at',
        'endedAt', 'ended_at',
        'end_time', 'endTime',
        'last_activity', 'lastActivity',
        'timestamp_updated', 'modified', 'lastUpdate', 'last_update',
        'meta.updatedAt', 'metadata.updatedAt',
      ]);
    }

    const normalizedCreatedAt = createdAtRaw || undefined;

    const sessionId = pick(['sessionId', '_id', 'id']);
    // Prefer explicit user_name in session data first
    const userNameFromSession = pick(['user_name', 'userName']);
    // Keep references to possible user identifiers for fallback resolution
    const userRef = pick(['user', 'userId', 'user_id', 'username', 'email', 'owner', 'ownerEmail']);
    const projectId = pick(['project_id', 'projectId', 'project', 'projectSlug']);
    const projectName = pick(['projectName', 'project_name', 'projectLabel', 'project_label']);
    const serviceType = pick(['serviceType', 'service_type', 'provider', 'modelProvider']);
    const tenant = pick(['tenant', 'tenantId', 'tenant_id', 'organization', 'organization_id', 'organizationId', 'tenantName', 'tenant_name']);

    // Resolve user display with strict preference: session.user_name -> resolved via userRef -> masked/short id -> 'Unknown User'
    let userName = undefined;
    if (userNameFromSession) {
      userName = String(userNameFromSession);
    } else {
      // Try resolving via users context if we only have an ID/reference
      const resolved = resolveUserName(userRef);
      if (resolved && resolved !== 'Unknown User') {
        userName = resolved;
      } else {
        // As a last resort, show a masked/shortened identifier if available (avoid leaking full raw IDs)
        const rawId =
          (typeof userRef === 'string' && userRef) ||
          (typeof userRef === 'object' && (userRef?._id || userRef?.id || userRef?.userId)) ||
          undefined;
        if (rawId && typeof rawId === 'string') {
          // Mask: show first 4 and last 4 chars if length > 10, else show as-is
          if (rawId.length > 10) {
            userName = `${rawId.slice(0, 4)}…${rawId.slice(-4)}`;
          } else {
            userName = rawId;
          }
        } else {
          userName = 'Unknown User';
        }
      }
    }

    // Compute duration using created_at and the normalized last_updated
    const durationStr = computeDuration(normalizedCreatedAt, normalizedLastUpdatedAt);

    // Dev-only diagnostics to help trace missing fields during development
    if (process.env.NODE_ENV !== 'production') {
      try {
        // eslint-disable-next-line no-console
        console.debug('[SessionDetailsModal] session received (keys):', Object.keys(s || {}));
        // eslint-disable-next-line no-console
        console.debug('[SessionDetailsModal] key fields snapshot:', {
          user_name_raw: s?.user_name ?? s?.userName,
          user_ref: s?.user ?? s?.userId ?? s?.user_id ?? s?.username ?? s?.email ?? s?.owner ?? s?.ownerEmail,
          created_raw: s?.created_at ?? s?.createdAt ?? s?.startedAt ?? s?.start_time ?? s?.startTime,
          last_updated_raw: s?.last_updated ?? s?.updated_at ?? s?.updatedAt ?? s?.lastUpdatedAt ?? s?.endedAt ?? s?.finishedAt ?? s?.lastActivityAt,
        });
      } catch {
        // ignore logging errors
      }
    }

    // Build detail fields ensuring the five required are present
    const details = {
      'User': userName || 'Unknown User',                       // user_name preferred, never raw ID if name exists
      'Session ID': sessionId ?? '—',
      'Project ID': projectId ?? projectName ?? '—',            // project_id with name fallback
      'Service Type': serviceType ?? '—',                       // service_type
      Tenant: tenant ?? '—',
      'Created At': formatDate(normalizedCreatedAt),            // created_at
      'Last Updated At': formatDate(normalizedLastUpdatedAt),   // last_updated
      Duration: durationStr,                                    // computed if both present
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
