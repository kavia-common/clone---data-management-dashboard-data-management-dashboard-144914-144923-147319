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
            <span className="agent-title-name">{agentName || agent?.name || "Agent"}</span>
            {agentId != null && agentId !== "" ? (
              <span className="agent-title-id">ID: {String(agentId)}</span>
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
              {agent?.name ? <span className="chip"><strong>Name:</strong> {agent.name}</span> : null}
              {agentId != null ? <span className="chip"><strong>ID:</strong> {String(agentId)}</span> : null}
              {agent?.last_active || agent?.lastActive ? (
                <span className="chip">
                  <strong>Last Active:</strong>{" "}
                  {new Date(agent.last_active || agent.lastActive).toLocaleString()}
                </span>
              ) : null}
              {agent?.total_cost != null || agent?.totalCost != null ? (
                <span className="chip">
                  <strong>Total Cost:</strong>{" "}
                  {String(agent.total_cost ?? agent.totalCost)}
                </span>
              ) : null}
            </div>

            {/* Use DetailsViewer to present full payload with consistent UI */}
            <DetailsViewer
              data={agent}
              title="Agent payload"
              collapsedDepth={1}
              highlightKeys={[
                "name",
                "_id",
                "id",
                "last_active",
                "lastActive",
                "total_cost",
                "totalCost",
              ]}
            />
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
          max-height: 60vh;
          overflow-y: auto;
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
