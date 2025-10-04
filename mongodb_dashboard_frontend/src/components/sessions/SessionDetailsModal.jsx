import React, { useEffect, useMemo, useRef } from 'react';
import Modal from '../ui/Modal.jsx';

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

  // Collect required details only; hide disallowed fields.
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

    // Normalize timestamps with broad alias coverage
    const startedAtRaw = pick([
      'startedAt', 'start_time', 'startTime', 'created_at', 'createdAt', 'created', 'timestamp', 'session_start', 'sessionStart',
      // sometimes "begin" variants
      'begin_time', 'beginTime'
    ]);

    // Cover all listed backend variants for last update / end markers
    const lastUpdatedAtRaw = pick([
      'lastUpdatedAt', 'updatedAt', 'updated_at',
      'modifiedAt', 'modified_at',
      'lastModified', 'last_modified',
      'lastActivityAt', 'last_activity_at',
      'finishedAt', 'finished_at',
      'endedAt', 'ended_at',
      'end_time', 'endTime',
      'last_activity', 'lastActivity',
      'timestamp_updated', 'modified', 'lastUpdate', 'last_update',
      // Some APIs track Mongoose-style updated path inside metadata
      'meta.updatedAt', 'metadata.updatedAt',
    ]);

    // Fallbacks: if we have an explicit "ended" field prefer that as lastUpdated; else updated; else activity; else undefined
    let normalizedLastUpdatedAt = lastUpdatedAtRaw;
    if (!normalizedLastUpdatedAt) {
      const ended = pick(['endedAt','ended_at','end_time','endTime','finishedAt','finished_at']);
      const updated = pick(['updatedAt','updated_at','modifiedAt','modified_at','lastModified','last_modified','timestamp_updated','modified','lastUpdate','last_update']);
      const activity = pick(['lastActivityAt','last_activity_at','last_activity','lastActivity']);
      normalizedLastUpdatedAt = ended || updated || activity || undefined;
    }

    const normalizedStartedAt = startedAtRaw || undefined;

    const sessionId = pick(['sessionId', '_id', 'id']);
    const user = pick(['user', 'userId', 'user_id', 'username', 'user_name', 'email', 'owner', 'ownerEmail']);
    const project = pick(['project', 'projectId', 'project_id', 'projectName', 'project_name']);
    const tenant = pick(['tenant', 'tenantId', 'tenant_id', 'organization', 'organization_id', 'organizationId', 'tenantName', 'tenant_name']);

    const durationStr = computeDuration(normalizedStartedAt, normalizedLastUpdatedAt);

    // Dev-only diagnostics to help trace missing fields during development
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.debug('[SessionDetailsModal] session received:', { session });
      if (!normalizedStartedAt) {
        // eslint-disable-next-line no-console
        console.warn('[SessionDetailsModal] Started At not found in session. Probed keys did not resolve.');
      }
      if (!normalizedLastUpdatedAt) {
        // eslint-disable-next-line no-console
        console.warn('[SessionDetailsModal] Last Updated At not found in session. Probed keys did not resolve.');
      }
    }

    // Only include the approved labels and order
    return {
      User: user ?? '—',
      'Session ID': sessionId ?? '—',
      Project: project ?? '—',
      Tenant: tenant ?? '—',
      'Started At': formatDate(normalizedStartedAt),
      'Last Updated At': formatDate(normalizedLastUpdatedAt),
      Duration: durationStr,
    };
  }, [session]);

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
