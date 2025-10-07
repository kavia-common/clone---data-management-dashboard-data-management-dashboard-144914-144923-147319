import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';

// Keep existing API call intact
import { getAgentById } from '../../api/agents';

// Reuse existing UI primitives
import Modal from '../ui/Modal';
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
 * Helper: Get initials from a name string
 */
function getInitials(name) {
  if (!name || typeof name !== 'string') return '?';
  return name
    .split(' ')
    .map(word => word.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('');
}

/**
 * Helper: Create a safe filename slug from name and id
 */
function createSafeSlug(name, id) {
  const safeName = (name || 'agent').replace(/[^a-zA-Z0-9-_]/g, '_');
  const safeId = (id || 'unknown').replace(/[^a-zA-Z0-9-_]/g, '_');
  return `${safeName}_${safeId}`;
}

/**
 * Helper: Copy text to clipboard with feedback
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Accessible horizontal scroller component for related content
 */
function AgentHorizontalScroller({ items, onItemClick, className = '' }) {
  const containerRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollButtons = useCallback(() => {
    if (containerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = containerRef.current;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1);
    }
  }, []);

  useEffect(() => {
    updateScrollButtons();
    const container = containerRef.current;
    if (container) {
      container.addEventListener('scroll', updateScrollButtons);
      return () => container.removeEventListener('scroll', updateScrollButtons);
    }
  }, [updateScrollButtons, items]);

  const scrollBy = (delta) => {
    if (containerRef.current) {
      containerRef.current.scrollBy({ left: delta, behavior: 'smooth' });
    }
  };

  if (!items || items.length === 0) {
    return null;
  }

  return (
    <div className={`agent-scroller ${className}`}>
      <button
        type="button"
        className="agent-scroller-btn agent-scroller-btn-left"
        onClick={() => scrollBy(-240)}
        aria-label="Scroll left"
        disabled={!canScrollLeft}
        tabIndex={canScrollLeft ? 0 : -1}
      >
        ‹
      </button>
      <div 
        className="agent-scroller-track" 
        ref={containerRef} 
        role="list"
        aria-label="Related items"
      >
        {items.map((item, idx) => (
          <button
            key={item.id || item.key || idx}
            type="button"
            className="agent-chip"
            onClick={() => onItemClick && onItemClick(item)}
            role="listitem"
            tabIndex={0}
          >
            <span className="agent-chip-text">
              {item.label || item.name || item.id || `Item ${idx + 1}`}
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="agent-scroller-btn agent-scroller-btn-right"
        onClick={() => scrollBy(240)}
        aria-label="Scroll right"
        disabled={!canScrollRight}
        tabIndex={canScrollRight ? 0 : -1}
      >
        ›
      </button>
    </div>
  );
}

AgentHorizontalScroller.propTypes = {
  items: PropTypes.arrayOf(PropTypes.object),
  onItemClick: PropTypes.func,
  className: PropTypes.string,
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

    const type = agent.type || agent.agentType || agent.category || null;
    const version = agent.version || agent.agentVersion || null;
    const status = agent.status || agent.state || null;
    
    const createdAt = agent.created_at || agent.createdAt || agent.timestamp || agent.created || null;
    const updatedAt = agent.updated_at || agent.updatedAt || null;
    const lastActive = agent.last_active || agent.lastActive || agent.lastActivityAt || null;
    
    const totalCost = agent.total_cost || agent.totalCost || agent.cost || 0;

    // Extract metadata and tags
    const metadata = agent.metadata || agent.meta || agent.details || null;
    const tags = Array.isArray(agent.tags) ? agent.tags : 
                 Array.isArray(agent.labels) ? agent.labels :
                 Array.isArray(agent.keywords) ? agent.keywords : [];

    return {
      id,
      name,
      type,
      version,
      status,
      createdAt,
      updatedAt,
      lastActive,
      totalCost,
      tags,
      metadata,
      raw: agent,
    };
  }, [agent]);
}

/**
 * AgentDetailsModal
 * - Props:
 *   open: boolean - whether modal is visible
 *   onClose: function - close handler
 *   agentId: string - ID of agent to fetch when present
 *   agentName: string - optional name for title fallback
 */
export default function AgentDetailsModal({ open, onClose, agentId, agentName }) {
  // Redesigned v2 - Add defensive logging to confirm component renders
  console.debug('[AgentDetailsModal REDESIGNED] mounted', { open, agentId, agentName });
  
  const [agent, setAgent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [activeTab, setActiveTab] = useState('summary');
  const [copyFeedback, setCopyFeedback] = useState('');
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
      setCopyFeedback('');
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agentId]);

  const normalized = useNormalizedAgent(agent);

  // Handle copy ID functionality
  const handleCopyId = useCallback(async () => {
    const idToCopy = normalized?.id || agentId;
    if (idToCopy) {
      const success = await copyToClipboard(String(idToCopy));
      setCopyFeedback(success ? 'Copied!' : 'Failed to copy');
      setTimeout(() => setCopyFeedback(''), 2000);
    }
  }, [normalized?.id, agentId]);

  // Download JSON handler
  const handleDownload = useCallback(() => {
    const data = normalized?.raw || agent || {};
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const filename = `${createSafeSlug(normalized?.name, normalized?.id)}.json`;
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [agent, normalized]);

  // Tab navigation with keyboard support
  const handleTabKeyDown = useCallback((event, tabKey) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const tabs = ['summary', 'raw'];
      const currentIndex = tabs.indexOf(activeTab);
      let newIndex;
      
      if (event.key === 'ArrowLeft') {
        newIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
      } else {
        newIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
      }
      
      setActiveTab(tabs[newIndex]);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setActiveTab(tabKey);
    }
  }, [activeTab]);

  // Build tag items for scroller
  const tagItems = useMemo(() => {
    if (!normalized?.tags?.length) return [];
    return normalized.tags.map((tag) => ({ id: tag, label: tag }));
  }, [normalized]);

  const titleText = normalized?.name || agentName || 'Agent Details';
  const initials = getInitials(normalized?.name || agentName);

  // Build status chips data
  const statusChips = useMemo(() => {
    const chips = [];
    if (normalized?.lastActive) {
      chips.push({
        label: 'Last Active',
        value: safeFormatDate(normalized.lastActive),
        icon: '🕒',
        type: 'info'
      });
    }
    if (normalized?.totalCost && normalized.totalCost > 0) {
      chips.push({
        label: 'Total Cost',
        value: `$${normalized.totalCost.toFixed(4)}`,
        icon: '💰',
        type: 'cost'
      });
    }
    return chips;
  }, [normalized]);

  // Modal content based on state
  let bodyContent = null;

  if (loading) {
    bodyContent = (
      <div className="agent-loading" role="status" aria-live="polite">
        <div className="agent-skeleton-avatar"></div>
        <div className="agent-skeleton-header"></div>
        <div className="agent-skeleton-chips">
          <div className="agent-skeleton-chip"></div>
          <div className="agent-skeleton-chip"></div>
        </div>
        <div className="agent-skeleton-grid">
          <div className="agent-skeleton-card"></div>
          <div className="agent-skeleton-card"></div>
          <div className="agent-skeleton-card"></div>
          <div className="agent-skeleton-card"></div>
        </div>
      </div>
    );
  } else if (err) {
    bodyContent = (
      <div className="agent-error-state" role="alert" aria-live="assertive">
        <div className="agent-error-icon">⚠️</div>
        <div className="agent-error-title">Unable to Load Agent</div>
        <div className="agent-error-message">
          {err?.message || 'An unexpected error occurred while loading the agent details.'}
        </div>
        <div className="agent-error-actions">
          <button
            type="button"
            className="agent-btn agent-btn-primary"
            onClick={retry}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  } else if (!normalized) {
    bodyContent = (
      <div className="agent-empty-state" role="status" aria-live="polite">
        <div className="agent-empty-icon">🤖</div>
        <div className="agent-empty-title">No Agent Data</div>
        <div className="agent-empty-message">
          {agentId || agentName
            ? `No details available for ${agentName || 'Agent'} ${agentId ? `(${agentId})` : ''}.`
            : 'Select an agent to view its details.'}
        </div>
      </div>
    );
  } else {
    bodyContent = (
      <>
        {/* Agent Header */}
        <div className="agent-header">
          <div className="agent-avatar">
            <span className="agent-avatar-text">{initials}</span>
          </div>
          <div className="agent-header-info">
            <h2 className="agent-name">
              {normalized.name}
              <span className="agent-details-version-badge">v2</span>
            </h2>
            <div className="agent-id-row">
              <span className="agent-id">ID: {normalized.id}</span>
              <button
                type="button"
                className="agent-copy-btn"
                onClick={handleCopyId}
                title="Copy ID to clipboard"
                aria-label="Copy agent ID to clipboard"
              >
                📋
              </button>
              {copyFeedback && (
                <span className="agent-copy-feedback" aria-live="polite">
                  {copyFeedback}
                </span>
              )}
            </div>
            {(normalized.type || normalized.version) && (
              <div className="agent-badge">
                {normalized.type && <span className="agent-type">{normalized.type}</span>}
                {normalized.version && <span className="agent-version">v{normalized.version}</span>}
              </div>
            )}
          </div>
        </div>

        {/* Status Chips */}
        {statusChips.length > 0 && (
          <div className="agent-status-chips">
            {statusChips.map((chip, index) => (
              <div key={index} className={`agent-status-chip agent-status-${chip.type}`}>
                <span className="agent-status-icon">{chip.icon}</span>
                <div className="agent-status-content">
                  <span className="agent-status-label">{chip.label}</span>
                  <span className="agent-status-value">{chip.value}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tags Scroller */}
        {tagItems.length > 0 && (
          <div className="agent-section">
            <h3 className="agent-section-title">Tags</h3>
            <AgentHorizontalScroller
              items={tagItems}
              onItemClick={() => {/* Could filter content by tag */}}
            />
          </div>
        )}

        {/* Tabs */}
        <div className="agent-tabs-container">
          <div
            className="agent-tabs"
            role="tablist"
            aria-label="Agent details sections"
          >
            <button
              role="tab"
              aria-selected={activeTab === 'summary'}
              aria-controls="agent-panel-summary"
              className={`agent-tab ${activeTab === 'summary' ? 'active' : ''}`}
              onClick={() => setActiveTab('summary')}
              onKeyDown={(e) => handleTabKeyDown(e, 'summary')}
            >
              Summary
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'raw'}
              aria-controls="agent-panel-raw"
              className={`agent-tab ${activeTab === 'raw' ? 'active' : ''}`}
              onClick={() => setActiveTab('raw')}
              onKeyDown={(e) => handleTabKeyDown(e, 'raw')}
            >
              Raw Data
            </button>
          </div>
        </div>

        {/* Tab Panels */}
        <div className="agent-tab-panels">
          {activeTab === 'summary' && (
            <div
              id="agent-panel-summary"
              role="tabpanel"
              aria-labelledby="agent-tabs"
              className="agent-panel"
            >
              <div className="agent-summary-grid">
                <div className="agent-summary-card">
                  <div className="agent-card-title">Name</div>
                  <div className="agent-card-value">{normalized.name || 'N/A'}</div>
                </div>
                <div className="agent-summary-card">
                  <div className="agent-card-title">ID</div>
                  <div className="agent-card-value">{normalized.id || 'N/A'}</div>
                </div>
                <div className="agent-summary-card">
                  <div className="agent-card-title">Status</div>
                  <div className="agent-card-value">{normalized.status || 'N/A'}</div>
                </div>
                <div className="agent-summary-card">
                  <div className="agent-card-title">Type</div>
                  <div className="agent-card-value">{normalized.type || 'N/A'}</div>
                </div>
                <div className="agent-summary-card">
                  <div className="agent-card-title">Created</div>
                  <div className="agent-card-value">{safeFormatDate(normalized.createdAt)}</div>
                </div>
                <div className="agent-summary-card">
                  <div className="agent-card-title">Updated</div>
                  <div className="agent-card-value">{safeFormatDate(normalized.updatedAt)}</div>
                </div>
              </div>

              {normalized.metadata && (
                <div className="agent-metadata-section">
                  <h3 className="agent-section-title">Metadata</h3>
                  <div className="agent-metadata-viewer">
                    <DetailsViewer data={normalized.metadata} />
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'raw' && (
            <div
              id="agent-panel-raw"
              role="tabpanel"
              aria-labelledby="agent-tabs"
              className="agent-panel"
            >
              <div className="agent-raw-data">
                <AgentHorizontalScroller
                  items={[{ id: 'expand', label: 'Expand All' }, { id: 'collapse', label: 'Collapse All' }]}
                  onItemClick={(item) => {
                    // Could implement expand/collapse functionality
                    console.log('Raw data action:', item.id);
                  }}
                  className="agent-raw-controls"
                />
                <div className="agent-raw-viewer">
                  <DetailsViewer data={normalized.raw} />
                </div>
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  // Sticky footer actions
  const footerActions = (
    <div className="agent-footer-actions">
      <button
        type="button"
        className="agent-btn agent-btn-outline"
        onClick={handleDownload}
        disabled={!normalized}
        title="Download agent data as JSON"
      >
        Download JSON
      </button>
      <button
        type="button"
        className="agent-btn agent-btn-primary"
        onClick={onClose}
        title="Close modal"
      >
        Close
      </button>
    </div>
  );

  return (
    <Modal 
      open={open} 
      onClose={onClose}
      title={titleText}
      footer={footerActions}
      width="min(96vw, 920px)"
    >
      <div className="agent-modal-content">
        {bodyContent}
      </div>
    </Modal>
  );
}

AgentDetailsModal.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func,
  agentId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  agentName: PropTypes.string,
};
