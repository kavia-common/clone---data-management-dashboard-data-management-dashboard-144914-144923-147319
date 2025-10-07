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

  return (
    <Modal
      title={title}
      open={open}
      onClose={onClose}
      headerOffset={60}
      modalZIndex={1250}
      overlayZIndex={1240}
    >
      <div className="sticky-header agent-header">
        <div className="agent-header-left">
          <div className="agent-title">
            <span className="agent-title-name">{normalized.name || "Agent"}</span>
            {normalized.id ? (
              <span className="agent-title-id">ID: {normalized.id}</span>
            ) : null}
          </div>
        </div>
        <div className="agent-actions">
          <button className="btn btn-ghost" onClick={onClose} title="Close">Close</button>
        </div>
      </div>

      <div className="agent-body">
        {loading ? (
          <div className="agent-loading" role="status" aria-live="polite">
            <div className="skeleton-line" />
            <div className="skeleton-line" />
            <div className="skeleton-line wide" />
          </div>
        ) : error ? (
          <div className="error" role="alert">{error}</div>
        ) : agent ? (
          <div className="agent-details">
            {/* Quick summary chips */}
            <div className="agent-summary">
              {normalized.name ? <span className="chip"><strong>Name:</strong> {normalized.name}</span> : null}
              {normalized.id ? <span className="chip"><strong>ID:</strong> {normalized.id}</span> : null}
              {normalized.type ? <span className="chip"><strong>Type:</strong> {normalized.type}</span> : null}
              {normalized.version ? <span className="chip"><strong>Version:</strong> {normalized.version}</span> : null}
              {normalized.lastActive ? (
                <span className="chip">
                  <strong>Last Active:</strong>{" "}
                  {(() => {
                    try { return new Date(normalized.lastActive).toLocaleString(); } catch { return String(normalized.lastActive); }
                  })()}
                </span>
              ) : null}
              {normalized.totalCost != null ? (
                <span className="chip">
                  <strong>Total Cost:</strong>{" "}
                  {String(normalized.totalCost)}
                </span>
              ) : null}
            </div>

            {/* Use DetailsViewer to present full payload with consistent UI, wrapped in horizontal scroll region */}
            <AgentHorizontalScroller>
              <DetailsViewer
                data={agent}
                title="Agent payload"
                collapsedDepth={1}
                highlightKeys={[
                  "name",
                  "_id",
                  "id",
                  "agent_id",
                  "agentId",
                  "type",
                  "agent_type",
                  "version",
                  "last_active",
                  "lastActive",
                  "total_cost",
                  "totalCost",
                  "metadata",
                ]}
              />
            </AgentHorizontalScroller>
          </div>
        ) : (
          <div className="agent-empty">
            <p className="muted">No detailed data available for this agent.</p>
            {(agentId || agentName) ? (
              <div className="agent-fallback">
                <div><strong>Name:</strong> {agentName || "—"}</div>
                <div><strong>ID:</strong> {agentId != null ? String(agentId) : "—"}</div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <style>{`
        .agent-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 16px;
          border-bottom: 1px solid var(--border-subtle);
          background: var(--bg-surface);
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .agent-title {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .agent-title-name {
          font-size: 16px;
          font-weight: 800;
          color: var(--text-primary);
        }
        .agent-title-id {
          font-size: 12px;
          color: var(--text-tertiary);
          background: var(--badge-bg);
          border-radius: 999px;
          padding: 2px 8px;
          font-weight: 700;
        }
        .agent-actions { display: inline-flex; gap: 8px; }

        .agent-body { 
          padding: 12px 16px 16px 16px; 
          display: grid; 
          gap: 12px; 
        }
        .agent-summary { display: inline-flex; gap: 8px; flex-wrap: wrap; }
        .chip {
          background: linear-gradient(90deg, rgba(37,99,235,0.08), rgba(249,250,251,1));
          color: var(--text-primary);
          border: 1px solid var(--border-subtle);
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 12px;
          font-weight: 600;
        }
        .agent-details { 
          display: grid; 
          gap: 12px; 
        }
        
        /* Ensure no accordion/dropdown behavior in agent details */
        .agent-details .dv-toggle {
          pointer-events: auto;
          cursor: pointer;
        }
        .agent-details .dv-section {
          background: rgba(249, 250, 251, 0.5);
          border-radius: 6px;
          padding: 8px;
        }

        .agent-loading { display: grid; gap: 8px; }
        .skeleton-line {
          height: 12px;
          border-radius: 999px;
          background: linear-gradient(90deg, #e3f2ff, #f1f5f9, #e3f2ff);
          animation: shimmer 1.2s infinite linear;
        }
        .skeleton-line.wide { height: 16px; }
        @keyframes shimmer {
          0% { background-position: -240px 0; }
          100% { background-position: 240px 0; }
        }

        .agent-empty { padding: 8px 0; }
        .agent-fallback { display: grid; gap: 4px; margin-top: 6px; }
      `}</style>
    </Modal>
  );
}

/**
 * AgentHorizontalScroller
 * A local-only utility for AgentDetailsModal to enable horizontal scrolling of wide nested content
 * without expanding modal width. Shows left/right buttons when scrollable and disables at edges.
 */
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

      <style>{`
        .agent-hscroll-wrap {
          position: relative;
        }
        .agent-hscroll {
          overflow-x: auto;
          overflow-y: visible;
          white-space: normal; /* allow blocks to keep natural width; nested tables/blocks can overflow horizontally */
          padding-bottom: 4px; /* space for potential scrollbar */
          background: #f9fafb; /* neutral background per theme */
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
        }
        .hs-btn {
          position: absolute;
          top: 8px;
          z-index: 2;
          height: 28px;
          width: 28px;
          display: grid;
          place-items: center;
          border-radius: 999px;
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
    </div>
  );
}
