import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';

// Keep existing API call intact
import { getAgentById } from '../../api/agents';

// Reuse existing UI primitives if available, otherwise safely fall back
import Modal from '../ui/Modal';
import Tabs from '../ui/Tabs';
import Button from '../ui/Button';
import DetailsViewer from '../common/DetailsViewer';

import './AgentDetailsModal.css';

/**
 * Helper: safely format dates from string/number/Date.
 * Returns 'N/A' when invalid.
 */
function safeFormatDate(value) {
  try {
    if (!value) return 'N/A';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'N/A';
    return d.toLocaleString();
  } catch {
    return 'N/A';
  }
}

/**
 * Lightweight internal horizontal scroller for small related content rows.
 * Ensures accessible buttons and visible labels.
 */
function AgentHorizontalScroller({ items, onItemClick }) {
  const containerRef = useRef(null);

  const scrollBy = (delta) => {
    if (containerRef.current) {
      containerRef.current.scrollBy({ left: delta, behavior: 'smooth' });
    }
  };

  if (!items || items.length === 0) {
    return null;
  }

  return (
    <div className="agent-scroller">
      <button
        type="button"
        className="agent-btn agent-btn-ghost agent-scroller-btn"
        onClick={() => scrollBy(-240)}
        aria-label="Scroll left"
        title="Scroll left"
      >
        ‹
      </button>
      <div className="agent-scroller-track" ref={containerRef} role="list">
        {items.map((it, idx) => (
          <button
            key={it.id || it.key || idx}
            type="button"
            className="agent-chip"
            onClick={() => onItemClick && onItemClick(it)}
            role="listitem"
            title={String(it.label || it.name || it.id || 'Item')}
          >
            <span className="agent-chip-text">
              {it.label || it.name || it.id || `Item ${idx + 1}`}
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="agent-btn agent-btn-ghost agent-scroller-btn"
        onClick={() => scrollBy(240)}
        aria-label="Scroll right"
        title="Scroll right"
      >
        ›
      </button>
    </div>
  );
}

AgentHorizontalScroller.propTypes = {
  items: PropTypes.arrayOf(PropTypes.object),
  onItemClick: PropTypes.func,
};

/**
 * Normalize the agent object into a consistent shape for presentation.
 * This is memoized to avoid unnecessary recalculations.
 */
function useNormalizedAgent(agent) {
  return useMemo(() => {
    if (!agent || typeof agent !== 'object') return null;

    const id = agent.id || agent._id || agent.agent_id || agent.uid || null;
    const name =
      agent.name ||
      agent.agentName ||
      agent.title ||
      agent.display_name ||
      agent.identifier ||
      null;

    const createdAt =
      agent.created_at || agent.createdAt || agent.timestamp || agent.created || null;
    const updatedAt = agent.updated_at || agent.updatedAt || null;

    // Basic metadata extraction with resilience
    const metadata =
      agent.metadata ||
      agent.meta ||
      agent.details ||
      (agent.data && typeof agent.data === 'object' ? agent.data : null) ||
      null;

    // Optional tags/list-like fields
    const tags =
      agent.tags ||
      agent.labels ||
      agent.topics ||
      (Array.isArray(agent.keywords) ? agent.keywords : null) ||
      [];

    return {
      id,
      name,
      createdAt,
      updatedAt,
      tags: Array.isArray(tags) ? tags : [],
      metadata,
      raw: agent,
    };
  }, [agent]);
}

const DEFAULT_TABS = [
  { key: 'summary', label: 'Summary' },
  { key: 'raw', label: 'Raw Data' },
];

/**
 * AgentDetailsModal
 * - Props:
 *   open: boolean - whether modal is visible
 *   onClose: function - close handler
 *   agentId: string - ID of agent to fetch when present
 *   agentName: string - optional name for title fallback
 */
export default function AgentDetailsModal({ open, onClose, agentId, agentName }) {
  const [agent, setAgent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [activeTab, setActiveTab] = useState('summary');
  const abortRef = useRef(null);

  // Fetch agent details (respects cancellation)
  const fetchAgent = useCallback(
    async (id) => {
      if (!id) {
        setAgent(null);
        setErr(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setErr(null);

      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const data = await getAgentById(id, { signal: controller.signal });
        setAgent(data || null);
      } catch (e) {
        if (e?.name === 'AbortError') {
          // Ignore aborted requests
        } else {
          setErr(e || new Error('Failed to load agent'));
          setAgent(null);
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        setLoading(false);
      }
    },
    []
  );

  const retry = useCallback(() => {
    if (agentId) {
      fetchAgent(agentId);
    }
  }, [agentId, fetchAgent]);

  useEffect(() => {
    if (open && agentId) {
      fetchAgent(agentId);
    }
    if (!open) {
      // Reset on close for a clean state next open
      setAgent(null);
      setErr(null);
      setLoading(false);
      setActiveTab('summary');
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agentId]);

  const normalized = useNormalizedAgent(agent);

  const titleText = normalized?.name || agentName || 'Agent Details';
  const subtitleText = normalized?.id ? `ID: ${normalized.id}` : agentId ? `ID: ${agentId}` : null;

  // Download JSON handler
  const onDownload = useCallback(() => {
    const data = normalized?.raw || agent || {};
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = `${normalized?.name || 'agent'}_${normalized?.id || 'details'}.json`;
    a.href = url;
    a.download = safeName; // proper template literal logic handled above
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [agent, normalized]);

  // Accessible tab props
  const tabListId = 'agent-details-tabs';
  const panelIdSummary = 'agent-details-panel-summary';
  const panelIdRaw = 'agent-details-panel-raw';

  // Build possible tag chips for scroller demo (optional)
  const tagItems = useMemo(() => {
    if (!normalized?.tags?.length) return [];
    return normalized.tags.map((t) => ({ id: t, label: t }));
  }, [normalized]);

  // Body content based on state
  let bodyContent = null;

  if (loading) {
    bodyContent = (
      <div className="agent-loading" role="status" aria-live="polite">
        <div className="agent-skeleton-header" />
        <div className="agent-skeleton-line" />
        <div className="agent-skeleton-line short" />
        <div className="agent-skeleton-grid">
          <div className="agent-skeleton-card" />
          <div className="agent-skeleton-card" />
          <div className="agent-skeleton-card" />
        </div>
      </div>
    );
  } else if (err) {
    bodyContent = (
      <div className="agent-state agent-error" role="alert" aria-live="assertive">
        <div className="agent-state-title">We couldn’t load this agent</div>
        <div className="agent-state-subtext">
          {err?.message || 'An unexpected error occurred.'}
        </div>
        <div className="agent-actions">
          <button
            type="button"
            className="agent-btn agent-btn-primary"
            title="Retry loading agent"
            onClick={retry}
          >
            Retry
          </button>
          <button
            type="button"
            className="agent-btn agent-btn-ghost"
            title="Close"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    );
  } else if (!normalized) {
    bodyContent = (
      <div className="agent-state" role="status" aria-live="polite">
        <div className="agent-icon">🤖</div>
        <div className="agent-state-title">No agent data</div>
        <div className="agent-state-subtext">
          {agentId || agentName
            ? `No data available for ${agentName || 'Agent'} ${agentId ? `(ID: ${agentId})` : ''}.`
            : 'Select an agent to view details.'}
        </div>
      </div>
    );
  } else {
    bodyContent = (
      <>
        {tagItems.length > 0 && (
          <div className="agent-section">
            <div className="agent-section-title">Tags</div>
            <AgentHorizontalScroller
              items={tagItems}
              onItemClick={() => {
                /* noop: could filter content by tag */
              }}
            />
          </div>
        )}

        <div
          className="agent-tabs"
          role="tablist"
          aria-label="Agent details tabs"
          id={tabListId}
        >
          {DEFAULT_TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={activeTab === t.key}
              aria-controls={t.key === 'summary' ? panelIdSummary : panelIdRaw}
              className={`agent-tab ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => setActiveTab(t.key)}
              title={t.label}
            >
              {t.label}
            </button>
          ))}
          <div className="agent-tab-spacer" />
          <button
            type="button"
            className="agent-btn agent-btn-primary-outline"
            onClick={onDownload}
            title="Download as JSON"
          >
            Download JSON
          </button>
        </div>

        <div className="agent-tabpanel-wrapper">
          {activeTab === 'summary' && (
            <div
              id={panelIdSummary}
              role="tabpanel"
              aria-labelledby={tabListId}
              className="agent-panel"
            >
              <div className="agent-grid">
                <div className="agent-card">
                  <div className="agent-card-title">Name</div>
                  <div className="agent-card-value">{normalized.name || 'N/A'}</div>
                </div>
                <div className="agent-card">
                  <div className="agent-card-title">ID</div>
                  <div className="agent-card-value">{normalized.id || 'N/A'}</div>
                </div>
                <div className="agent-card">
                  <div className="agent-card-title">Created</div>
                  <div className="agent-card-value">{safeFormatDate(normalized.createdAt)}</div>
                </div>
                <div className="agent-card">
                  <div className="agent-card-title">Updated</div>
                  <div className="agent-card-value">{safeFormatDate(normalized.updatedAt)}</div>
                </div>
              </div>

              <div className="agent-section">
                <div className="agent-section-title">Metadata</div>
                {normalized.metadata ? (
                  <DetailsViewer data={normalized.metadata} />
                ) : (
                  <div className="agent-muted">No metadata available.</div>
                )}
              </div>
            </div>
          )}
          {activeTab === 'raw' && (
            <div
              id={panelIdRaw}
              role="tabpanel"
              aria-labelledby={tabListId}
              className="agent-panel"
            >
              <DetailsViewer data={normalized.raw} />
            </div>
          )}
        </div>
      </>
    );
  }

  // Wrap with the Modal wrapper and proper header/body/footer
  // Fallback to a simple container if Modal component is absent or incompatible
  const ModalWrapper = Modal
    ? Modal
    : ({ open: isOpen, onClose: close, children }) =>
        isOpen ? (
          <div className="agent-fallback-modal">
            <div className="agent-fallback-surface">
              <button className="agent-fallback-close" onClick={close} title="Close modal">
                ×
              </button>
              {children}
            </div>
          </div>
        ) : null;

  return (
    <ModalWrapper open={open} onClose={onClose}>
      <div className="agent-modal">
        <header className="agent-modal-header">
          <div>
            <h2 className="agent-title">{titleText}</h2>
            {subtitleText && <div className="agent-subtitle">{subtitleText}</div>}
          </div>
          {/* Optional area for future right-aligned actions */}
        </header>

        <main className="agent-modal-body">{bodyContent}</main>

        <footer className="agent-modal-footer">
          <div className="agent-footer-left" />
          <div className="agent-footer-right">
            <button
              type="button"
              className="agent-btn agent-btn-ghost"
              title="Close"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </footer>
      </div>
    </ModalWrapper>
  );
}

AgentDetailsModal.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func,
  agentId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  agentName: PropTypes.string,
};
