import React, { useEffect, useMemo, useRef } from 'react';
import Modal from '../ui/Modal.jsx';

/**
 * SessionDetailsModal
 * PUBLIC_INTERFACE
 * Props:
 * - open: boolean - whether the modal is visible
 * - onClose: function - called when closing the modal
 * - session: object - the selected session data to display
 *
 * This modal mirrors the styling/UX patterns used by TabbedUserModal:
 * - Subtle overlay backdrop
 * - Sticky header with title
 * - Internal scroll area for content
 * - Comfortable spacing
 * - Full-width red Close button (#EF4444) with hover state
 * - Accessibility: role="dialog", aria-modal, aria-labelledby
 */
function SessionDetailsModal({ open, onClose, session }) {
  const headerId = 'session-details-title';
  const contentRef = useRef(null);

  // Focus modal content on open (basic focus management if Modal doesn't trap focus)
  useEffect(() => {
    if (open && contentRef.current) {
      contentRef.current.focus();
    }
  }, [open]);

  // Formatters
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

  const toDisplay = useMemo(() => {
    // Build a flat display map from likely fields, guarding undefineds
    if (!session || typeof session !== 'object') return {};

    const s = session;
    // cover multiple possible key variants
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
    const metadata = get(['metadata', 'meta']);

    return {
      'Session ID': sessionId ?? '—',
      'Status': status ?? '—',
      'Started At': formatDate(startedAt),
      'Ended At': formatDate(endedAt),
      'Duration': duration !== undefined ? String(duration) : '—',
      'User': userId ?? '—',
      'Tenant': tenantId ?? '—',
      'Project': projectId ?? '—',
      'Requests': requestCount !== undefined ? String(requestCount) : '—',
      'Tokens Used': tokensUsed !== undefined ? String(tokensUsed) : '—',
      'Model': model ?? '—',
      'Source / IP': source ?? '—',
      'Metadata': metadata ? (typeof metadata === 'object' ? JSON.stringify(metadata, null, 2) : String(metadata)) : '—',
    };
  }, [session]);

  return (
    <Modal open={open} onClose={onClose}>
      {/* Overlay and container provided by Modal. We build internal structure like TabbedUserModal */}
      <div
        className="relative bg-white rounded-lg shadow-xl w-full max-w-3xl mx-auto max-h-[85vh] flex flex-col"
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
        </div>

        {/* Scrollable Content */}
        <div
          ref={contentRef}
          tabIndex={-1}
          id={`${headerId}-content`}
          className="overflow-y-auto px-6 py-5 space-y-6"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {/* Grid of labeled values */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {Object.entries(toDisplay).map(([label, value]) => (
              <div key={label} className="flex flex-col">
                <span className="text-xs uppercase tracking-wide text-gray-500">{label}</span>
                {label === 'Metadata' && value !== '—' ? (
                  <pre className="mt-1 text-sm text-gray-900 bg-gray-50 rounded p-3 overflow-x-auto">{value}</pre>
                ) : (
                  <span className="mt-1 text-sm text-gray-900 break-words">{value}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Footer with full-width Close button */}
        <div className="px-6 pb-6">
          <button
            type="button"
            onClick={onClose}
            className="w-full inline-flex items-center justify-center rounded-md bg-red-500 px-4 py-2.5 text-white font-medium shadow-sm hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default SessionDetailsModal;
