import React, { useEffect, useMemo, useState } from "react";
import Modal from "../ui/Modal.jsx";
import DetailsViewer from "../common/DetailsViewer.jsx";
import { getAgentById } from "../../api/agents";

/**
 * PUBLIC_INTERFACE
 * AgentDetailsModal
 * Displays details about a specific Agent. On open, fetches agent data
 * from the backend using GET /api/agents/:agentId (when available).
 *
 * Props:
 * - open: boolean - controls visibility
 * - onClose: function - close handler
 * - agentId: string|number - agent identifier to fetch
 * - agentName: string (optional) - friendly agent name for header
 */
export default function AgentDetailsModal({ open, onClose, agentId, agentName }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [agent, setAgent] = useState(null);

  const title = useMemo(() => {
    const base = agentName || agent?.name || "Agent Details";
    if (agentId != null && agentId !== "") {
      return `${base}`;
    }
    return base;
  }, [agentName, agent, agentId]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setAgent(null);
      setError("");
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    async function fetchAgent() {
      if (!open || (!agentId && agentId !== 0)) {
        return;
      }
      setLoading(true);
      setError("");
      try {
        console.debug("[AgentDetailsModal] fetch start", { agentId });
        const data = await getAgentById(agentId);
        if (!cancelled) {
          setAgent(data);
          // Clear error if we successfully get data
          setError("");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e?.response?.data?.message || e?.message || "Failed to load agent details.");
          setAgent(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          console.debug("[AgentDetailsModal] fetch end", { agentId });
        }
      }
    }
    fetchAgent();
    return () => {
      cancelled = true;
    };
  }, [open, agentId]);

  // Normalize frequently used fields for robust display
  const normalized = useMemo(() => {
    const a = agent || {};
    const nid =
      a.id ??
      a._id ??
      a.agentId ??
      a.agent_id ??
      a.metadata?.agent_id ??
      a.agent?.id ??
      (agentId != null ? agentId : null);
    const nname =
      agentName ||
      a.name ||
      a.agent_name ||
      a.agentName ||
      a.metadata?.name ||
      a.agent?.name ||
      null;
    const ntype = a.type || a.agent_type || a.metadata?.type || a.agent?.type || null;
    const nversion = a.version || a.metadata?.version || a.agent?.version || null;
    const nlast =
      a.last_active ||
      a.lastActive ||
      a.updated_at ||
      a.updatedAt ||
      a.timestamp ||
      null;
    const ncost = (a.total_cost ?? a.totalCost ?? a.cost ?? null);
    return {
      id: nid != null ? String(nid) : null,
      name: nname != null ? String(nname) : null,
      type: ntype != null ? String(ntype) : null,
      version: nversion != null ? String(nversion) : null,
      lastActive: nlast,
      totalCost: ncost,
    };
  }, [agent, agentId, agentName]);

  const downloadJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(agent, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `${normalized.name || 'agent'}_${normalized.id || 'details'}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  return (
    <Modal
      title={title}
      open={open}
      onClose={onClose}
      headerOffset={60}
      modalZIndex={1250}
      overlayZIndex={1240}
    >
      <div className="agent-modal-container">
        <div className="agent-header">
          <div className="agent-title-group">
            <h2 className="agent-name">{normalized.name || "Agent"}</h2>
            {normalized.id ? (
              <span className="agent-id">ID: {normalized.id}</span>
            ) : null}
          </div>
          <button className="btn-close" onClick={onClose} aria-label="Close modal">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="agent-body">
          {loading ? (
            <div className="loading-state" role="status" aria-live="polite">
              <div className="skeleton-line full" />
              <div className="skeleton-line half" />
              <div className="skeleton-line wide" />
            </div>
          ) : error ? (
            <div className="error-state" role="alert">
              <p className="error-message">⚠️ {error}</p>
            </div>
          ) : agent ? (
            <div className="agent-details">
              <div className="info-card summary-card">
                <h3 className="card-title">Summary</h3>
                <div className="summary-grid">
                  {normalized.name && <div><strong>Name:</strong> {normalized.name}</div>}
                  {normalized.id && <div><strong>ID:</strong> {normalized.id}</div>}
                  {normalized.type && <div><strong>Type:</strong> {normalized.type}</div>}
                  {normalized.version && <div><strong>Version:</strong> {normalized.version}</div>}
                  {normalized.lastActive && (
                    <div>
                      <strong>Last Active:</strong>{" "}
                      {(() => {
                        try { return new Date(normalized.lastActive).toLocaleString(); } catch { return String(normalized.lastActive); }
                      })()}
                    </div>
                  )}
                  {normalized.totalCost != null && <div><strong>Total Cost:</strong> {String(normalized.totalCost)}</div>}
                </div>
              </div>

              <div className="info-card raw-data-card">
                <div className="card-header">
                  <h3 className="card-title">Raw Data Payload</h3>
                  <button className="btn-download" onClick={downloadJson} title="Download JSON">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      <polyline points="7 10 12 15 17 10"></polyline>
                      <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                    Download
                  </button>
                </div>
                <AgentHorizontalScroller>
                  <DetailsViewer
                    data={agent}
                    title=""
                    collapsedDepth={1}
                    highlightKeys={[
                      "name", "_id", "id", "agent_id", "agentId", "type", "agent_type",
                      "version", "last_active", "lastActive", "total_cost", "totalCost", "metadata",
                    ]}
                  />
                </AgentHorizontalScroller>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <p className="muted">No detailed data available for this agent.</p>
              {(agentId || agentName) ? (
                <div className="fallback-details">
                  <div><strong>Name:</strong> {agentName || "—"}</div>
                  <div><strong>ID:</strong> {agentId != null ? String(agentId) : "—"}</div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
      <style>{`
        /* --- General Layout & Typography --- */
        :root {
          --bg-surface: #ffffff;
          --bg-subtle: #f9fafb;
          --bg-hover: #f3f4f6;
          --bg-card: #ffffff;
          --bg-error: #fef2f2;
          --text-primary: #111827;
          --text-secondary: #4b5563;
          --text-tertiary: #6b7280;
          --text-error: #dc2626;
          --border-subtle: #e5e7eb;
          --border-light: #d1d5db;
          --border-strong: #9ca3af;
          --border-error: #fca5a5;
          --badge-bg: #e5e7eb;
        }
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        }

        .agent-modal-container {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 400px;
          color: var(--text-primary);
        }

        .agent-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 24px;
          border-bottom: 1px solid var(--border-subtle);
          background: var(--bg-surface);
          position: sticky;
          top: 0;
          z-index: 10;
        }

        .agent-title-group {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        
        .agent-name {
          font-size: 1.25rem;
          font-weight: 700;
          margin: 0;
          color: var(--text-primary);
        }
        
        .agent-id {
          font-size: 0.875rem;
          color: var(--text-tertiary);
          background: var(--badge-bg);
          border-radius: 999px;
          padding: 4px 10px;
          font-weight: 600;
        }

        .btn-close {
          border: none;
          background: none;
          cursor: pointer;
          color: var(--text-secondary);
          padding: 8px;
          border-radius: 50%;
          transition: background-color 0.2s, color 0.2s;
        }

        .btn-close:hover {
          background-color: var(--bg-hover);
          color: var(--text-primary);
        }
        
        .agent-body { 
          padding: 24px;
          flex-grow: 1;
          display: flex;
          flex-direction: column;
          gap: 24px;
          overflow-y: auto;
        }
        
        /* --- Information Cards --- */
        .info-card {
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: 12px;
          padding: 20px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        }
        
        .card-title {
          font-size: 1rem;
          font-weight: 700;
          color: var(--text-secondary);
          margin-bottom: 16px;
        }

        .summary-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
          font-size: 0.95rem;
        }
        
        .summary-grid strong {
          color: var(--text-secondary);
          display: block;
          margin-bottom: 4px;
        }

        /* --- Raw Data Section --- */
        .raw-data-card .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }
        
        .btn-download {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border: 1px solid var(--border-light);
          border-radius: 8px;
          background: var(--bg-subtle);
          color: var(--text-secondary);
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.2s, border-color 0.2s;
        }
        
        .btn-download:hover {
          background-color: var(--bg-hover);
          border-color: var(--border-strong);
        }

        /* --- Empty & Loading States --- */
        .loading-state, .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px;
          background: var(--bg-subtle);
          border-radius: 12px;
        }
        
        .error-state {
          padding: 24px;
          background-color: var(--bg-error);
          border: 1px solid var(--border-error);
          border-radius: 12px;
          text-align: center;
        }
        
        .error-message {
          color: var(--text-error);
          font-weight: 600;
        }

        .skeleton-line {
          height: 14px;
          border-radius: 4px;
          background: linear-gradient(90deg, #e3f2ff, #f1f5f9, #e3f2ff);
          animation: shimmer 1.5s infinite linear;
          margin-bottom: 12px;
        }
        .skeleton-line.full { width: 90%; }
        .skeleton-line.half { width: 50%; }
        .skeleton-line.wide { height: 18px; width: 100%; }

        @keyframes shimmer {
          0% { background-position: -240px 0; }
          100% { background-position: 240px 0; }
        }

        /* --- AgentHorizontalScroller Styling (from original) --- */
        .agent-hscroll-wrap {
          position: relative;
        }
        .agent-hscroll {
          overflow-x: auto;
          overflow-y: visible;
          white-space: normal;
          padding: 4px 0;
          border-radius: 8px;
        }
        .hs-btn {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          z-index: 2;
          height: 36px;
          width: 36px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          border: 1px solid var(--border-subtle);
          background: #ffffff;
          color: #2563EB;
          box-shadow: 0 2px 6px rgba(0,0,0,0.08);
          transition: all 0.2s ease;
        }
        .hs-btn:hover:not(:disabled) {
          box-shadow: 0 4px 10px rgba(37,99,235,0.18);
          background: #f0f6ff;
        }
        .hs-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .hs-left { left: 8px; }
        .hs-right { right: 8px; }
      `}</style>
    </Modal>
  );
}

function AgentHorizontalScroller({ children }) {
  const scrollerRef = React.useRef(null);
  const [canScroll, setCanScroll] = React.useState(false);
  const [atStart, setAtStart] = React.useState(true);
  const [atEnd, setAtEnd] = React.useState(false);

  const updateState = React.useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const scrollable = el.scrollWidth > el.clientWidth + 2;
    setCanScroll(scrollable);
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);

  React.useEffect(() => {
    updateState();
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => updateState();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => updateState());
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [updateState]);

  const doScroll = (dir) => {
    const el = scrollerRef.current;
    if (!el) return;
    const delta = 320 * (dir === "left" ? -1 : 1);
    el.scrollBy({ left: delta, behavior: "smooth" });
  };

  return (
    <div className="agent-hscroll-wrap">
      {canScroll && (
        <>
          <button
            className="hs-btn hs-left"
            onClick={() => doScroll("left")}
            disabled={atStart}
            aria-label="Scroll left"
            title="Scroll left"
          >
            ‹
          </button>
          <button
            className="hs-btn hs-right"
            onClick={() => doScroll("right")}
            disabled={atEnd}
            aria-label="Scroll right"
            title="Scroll right"
          >
            ›
          </button>
        </>
      )}
      <div ref={scrollerRef} className="agent-hscroll" role="region" aria-label="Scrollable agent details">
        {children}
      </div>
    </div>
  );
}