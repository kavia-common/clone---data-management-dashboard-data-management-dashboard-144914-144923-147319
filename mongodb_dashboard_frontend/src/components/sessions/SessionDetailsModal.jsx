import React, { useEffect, useMemo, useRef } from 'react';
import Modal from '../ui/Modal.jsx';

/**
 * PUBLIC_INTERFACE
 * SessionDetailsModal
 * A responsive, accessible modal that presents session details in a clear two-column grid.
 *
 * Props:
 * - open: boolean - controls visibility
 * - onClose: function - invoked to close modal
 * - session: object - session data to render
 *
 * Design and UX:
 * - Subtle overlay provided by Modal component
 * - Sticky header with title; content area scrolls internally
 * - Core details section rendered as a 2-column responsive grid (1-column on small screens)
 * - Dedicated Metadata section separated by a divider and spacing
 * - Labels are muted with medium weight; values wrap to avoid horizontal scrolling
 * - Prominent full-width Close button in error color (#EF4444) with hover/focus states
 * - Ocean Professional theme: primary #2563EB, accent #F59E0B, error #EF4444
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

  // Collect the most relevant details using tolerant key extraction.
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

  const metadataValue = useMemo(() => {
    if (!session || typeof session !== 'object') return '—';
    const meta = session?.metadata ?? session?.meta;
    if (!meta && meta !== 0) return '—';
    if (typeof meta === 'object') return JSON.stringify(meta, null, 2);
    return String(meta);
  }, [session]);

  return (
    <Modal open={open} onClose={onClose}>
      {/* Outer container: ensure no horizontal overflow and internal scroll */}
      <div
        className="relative bg-white rounded-lg shadow-xl w-full max-w-3xl mx-auto max-h-[85vh] flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headerId}
        aria-describedby={`${headerId}-content`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b px-6 py-4">
          <h2 id={headerId} className="text-lg font-semibold text-gray-900">
            Session Details
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Review core information and metadata for the selected session.
          </p>
        </div>

        {/* Scrollable Content Wrapper: prefer wrapping, allow x-auto for extreme cases */}
        <div
          ref={contentRef}
          tabIndex={-1}
          id={`${headerId}-content`}
          className="px-6 py-5 space-y-8 overflow-y-auto overflow-x-auto"
          style={{
            WebkitOverflowScrolling: 'touch',
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
          }}
        >
          {/* Core details grid/table */}
          <section aria-label="Core details" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-[minmax(140px,1fr)_2fr] gap-4">
              {Object.entries(coreDetails).map(([label, value]) => (
                <React.Fragment key={label}>
                  <div className="min-w-0 md:text-right md:pr-4">
                    <div className="text-xs md:text-sm font-medium text-gray-600">
                      {label}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="mt-1 md:mt-0 text-sm text-gray-900 leading-6 break-words">
                      {value}
                    </div>
                  </div>
                </React.Fragment>
              ))}
            </div>
          </section>

          {/* Divider and Metadata */}
          <section aria-label="Metadata" className="mt-6">
            <hr className="border-gray-200" />
            <div className="mt-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">
                Metadata
              </h3>
              <span className="text-[11px] text-amber-600/80">
                Ocean Professional
              </span>
            </div>
            {metadataValue !== '—' ? (
              <pre className="mt-2 text-sm text-gray-900 bg-gray-50 rounded-md p-4 whitespace-pre-wrap break-words overflow-x-auto">
                {metadataValue}
              </pre>
            ) : (
              <div className="mt-2 text-sm text-gray-500">—</div>
            )}
          </section>
        </div>

        {/* Footer with full-width prominent Close button */}
        <div className="px-6 pb-6 pt-2 border-t bg-white">
          <button
            type="button"
            onClick={onClose}
            className="w-full inline-flex items-center justify-center rounded-lg bg-red-600 px-5 py-3 text-white font-semibold shadow-sm hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-600 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default SessionDetailsModal;
