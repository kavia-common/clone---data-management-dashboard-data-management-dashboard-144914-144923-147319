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
    if (!val) return '—';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return String(val);
      return d.toLocaleString();
    } catch {
      return String(val);
    }
  };

  // Collect core details using tolerant key extraction.
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
    const endedAt = get(['endedAt', 'end_time', 'endTime', 'updated_at', 'updatedAt']);
    const duration = get(['duration', 'durationMs', 'duration_ms', 'elapsed']);
    const userId = get(['userId', 'user_id', 'user']);
    const tenantId = get(['tenantId', 'tenant_id', 'tenant']);
    const status = get(['status', 'state']);
    const requestCount = get(['requestCount', 'requests', 'numRequests']);
    const tokensUsed = get(['tokensUsed', 'tokenUsage', 'tokens', 'totalTokens']);
    const model = get(['model', 'llm_model', 'llmModel']);
    const source = get(['source', 'ip', 'ipAddress', 'client_ip']);
    const sessionId = get(['sessionId', '_id', 'id']);
    const projectId = get(['projectId', 'project_id', 'project']);

    return {
      'Session ID': sessionId ?? '—',
      Status: status ?? '—',
      'Started At': formatDate(startedAt),
      'Ended At': formatDate(endedAt),
      Duration: duration !== undefined ? String(duration) : '—',
      User: userId ?? '—',
      Tenant: tenantId ?? '—',
      Project: projectId ?? '—',
      Requests: requestCount !== undefined ? String(requestCount) : '—',
      'Tokens Used': tokensUsed !== undefined ? String(tokensUsed) : '—',
      Model: model ?? '—',
      'Source / IP': source ?? '—',
    };
  }, [session]);

  // Derive a presentable title using primary identifiers (user or session)
  const derivedTitle = useMemo(() => {
    const nameLike = session?.user_name || session?.username || session?.user || '';
    const email = session?.email || '';
    const id = session?.sessionId || session?._id || session?.id || '';
    return (nameLike || email || id || 'Session Details');
  }, [session]);

  return (
    <Modal open={open} onClose={onClose}>
      {/* Outer container: modal card with refined paddings, rounded corners, and elevation */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headerId}
        aria-describedby={`${headerId}-content`}
        className="w-full"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#ffffff',
          borderRadius: 16,
          boxShadow: '0 8px 20px rgba(16,24,40,0.12)',
          // Responsive width with small-screen padding courtesy of Modal overlay
          width: 'min(720px, calc(100vw - 32px))',
          // Constrain height to viewport; internal area scrolls
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          // Hide overflow on the container; inner content region handles scrolling
          overflow: 'hidden',
          // Ensure this container is rendered above any app-level elements within the overlay
          zIndex: 1001,
        }}
      >
        {/* Sticky Header with subtle shadow */}
        <div
          className="sticky"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
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
            title={typeof derivedTitle === 'string' ? derivedTitle : undefined}
          >
            {derivedTitle}
          </h2>
        </div>

        {/* Scrollable content area; avoid horizontal scroll, ensure long text wraps */}
        <div
          ref={contentRef}
          tabIndex={-1}
          id={`${headerId}-content`}
          style={{
            padding: '16px 24px',
            paddingTop: 16,
            gap: 16,
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            overflowX: 'hidden',
            WebkitOverflowScrolling: 'touch',
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
          }}
        >
          {/* Details Card with accent rail */}
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
            {/* Accent Rail and optional warm dot */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 8,
                top: 8,
                bottom: 8,
                width: 6,
                background: 'var(--brand-200, #BFDBFE)',
                borderRadius: 8,
              }}
            />
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: 8,
                left: 6,
                width: 8,
                height: 8,
                background: 'var(--accent-warm, #F59E0B)',
                borderRadius: 9999,
              }}
            />

            {/* Inner grid: two columns desktop, one column on small screens */}
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

        {/* Footer with full-width prominent Close button */}
        <div
          style={{
            padding: '12px 16px',
            paddingTop: 12,
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
      </div>

      {/* Responsive adjustment for the details grid: collapse to one column on narrow viewports */}
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
