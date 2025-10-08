import React, { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import Modal from "../ui/Modal";
import { getAgentById } from "../../api/agents";
import { formatCurrencyAmount } from "../../utils/formatCurrency";
import { usdToCredits, formatCredits } from "../../utils/currency";

import "./AgentDetailsModal.css";

/**
 * PUBLIC_INTERFACE
 * AgentDetailsModal
 * A fresh, purpose-built modal for displaying agent cost details in the Costs tab.
 *
 * Props:
 * - open: boolean - whether the modal is shown
 * - onClose: function - close handler
 * - agentId: string|number - ID of the agent to fetch
 * - agentName?: string - optional name displayed in header
 *
 * Behavior:
 * - On open + agentId, fetches via getAgentById(agentId)
 * - Shows only: Cost, User Id, Projects, Type, User Cost (responsive grid)
 * - Robust long-text handling and no horizontal scroll
 * - Sticky footer with Close and Download JSON (enabled after data load)
 */
export default function AgentDetailsModal({ open, onClose, agentId, agentName, modalWidth, modalClassName }) {
  // Single debug line requested
  try {
    console.debug("[AgentDetailsModal:new]", { open, agentId });
  } catch {}

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [agent, setAgent] = useState(null);

  const title = useMemo(() => {
    return agentName ? `Agent Details — ${agentName}` : "Agent Details";
  }, [agentName]);

  const fetchAgent = useCallback(async (id) => {
    if (!id) {
      setAgent(null);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await getAgentById(id);
      setAgent(data || null);
      if (!data) {
        setError("No data found for this agent.");
      }
    } catch (e) {
      setAgent(null);
      setError(e?.message || "Failed to load agent.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && agentId) {
      fetchAgent(agentId);
    }
    if (!open) {
      // Reset when closing
      setLoading(false);
      setError("");
      setAgent(null);
    }
  }, [open, agentId, fetchAgent]);

  // Normalize agent fields with defensive extraction
  const normalized = useMemo(() => {
    if (!agent || typeof agent !== "object") return null;

    const getFirst = (...vals) => {
      for (const v of vals) {
        if (v !== undefined && v !== null) return v;
      }
      return undefined;
    };

    // cost fields
    const rawCost = getFirst(agent.total_cost, agent.totalCost, agent.cost);
    const rawUserCost = getFirst(agent.user_cost, agent.userCost, agent.metadata?.user_cost);

    const toNum = (v) => {
      if (v == null) return null;
      if (typeof v === "number") return Number.isFinite(v) ? v : null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const cost = toNum(rawCost) ?? rawCost ?? null;           // prefer numeric if parsable
    const userCost = toNum(rawUserCost) ?? rawUserCost ?? null;

    // user id
    const userId = getFirst(agent.user_id, agent.userId, agent.user?.id, agent.owner_id) ?? null;

    // type
    const type = getFirst(agent.type, agent.agent_type, agent.metadata?.type) ?? null;

    // projects -> number
    let projectsCount = null;
    if (agent.projects !== undefined) {
      if (Array.isArray(agent.projects)) {
        projectsCount = agent.projects.length;
      } else if (typeof agent.projects === "number") {
        projectsCount = agent.projects;
      } else if (agent.projects && typeof agent.projects === "object") {
        projectsCount = Object.keys(agent.projects).length;
      } else {
        const n = Number(agent.projects);
        projectsCount = Number.isFinite(n) ? n : null;
      }
    } else if (agent.project_count !== undefined) {
      const n = Number(agent.project_count);
      projectsCount = Number.isFinite(n) ? n : null;
    } else if (agent.metadata?.projects !== undefined) {
      const p = agent.metadata.projects;
      if (Array.isArray(p)) {
        projectsCount = p.length;
      } else if (typeof p === "number") {
        projectsCount = p;
      } else if (p && typeof p === "object") {
        projectsCount = Object.keys(p).length;
      }
    }

    return {
      cost,
      userId,
      projectsCount,
      type,
      userCost,
      raw: agent,
    };
  }, [agent]);

  const handleRetry = useCallback(() => {
    if (agentId) fetchAgent(agentId);
  }, [agentId, fetchAgent]);

  const handleDownloadJson = useCallback(() => {
    if (!normalized?.raw) return;
    const json = JSON.stringify(normalized.raw, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const fnameBase = (agentName || "agent").replace(/[^a-zA-Z0-9-_]/g, "_");
    a.href = url;
    a.download = `${fnameBase}_${String(agentId ?? "unknown")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [normalized, agentName, agentId]);

  // Formatting helpers
  const renderCurrency = (val) => {
    if (val == null) return "—";
    // If numeric or numeric string, use formatter + credits; else passthrough string
    const n = typeof val === "number" ? val : Number(val);
    if (Number.isFinite(n)) {
      const usdTxt = formatCurrencyAmount(n, { currency: "USD" });
      const creditsTxt = formatCredits(usdToCredits(n));
      // Example (detail row):
      //   $0.25 (5,000 credits)
      return (
        <span title={`${usdTxt} (${creditsTxt})`} style={{ whiteSpace: "nowrap" }}>
          {usdTxt}
          <span className="credits-inline muted">({creditsTxt})</span>
        </span>
      );
    }
    return String(val);
  };

  const renderProjects = (count) => {
    if (count == null) return "—";
    const n = typeof count === "number" ? count : Number(count);
    return Number.isFinite(n) ? n.toLocaleString() : String(count);
  };

  const content = (() => {
    if (loading) {
      return (
        <div className="adm-state" role="status" aria-live="polite">
          <div className="adm-spinner" aria-hidden="true" />
          <div className="adm-state-text">Loading...</div>
        </div>
      );
    }
    if (error) {
      return (
        <div className="adm-state" role="alert" aria-live="assertive">
          <div className="adm-state-text">{error}</div>
          <button type="button" className="adm-btn adm-btn-primary" onClick={handleRetry}>
            Retry
          </button>
        </div>
      );
    }
    if (!normalized) {
      return (
        <div className="adm-state" role="status" aria-live="polite">
          <div className="adm-state-text">No agent data found.</div>
        </div>
      );
    }

    return (
      <>
        <header className="adm-header">
          <div className="adm-title">
            <h2 className="adm-title-text">Agent Details</h2>
            {agentName ? <div className="adm-subtitle" title={agentName}>{agentName}</div> : null}
          </div>
        </header>

        <div className="adm-body" role="region" aria-label="Agent details">
          <div className="adm-grid">
            <div className="adm-row">
              <div className="adm-label">Cost</div>
              <div className="adm-value">{renderCurrency(normalized.cost)}</div>
            </div>
            <div className="adm-row">
              <div className="adm-label">User Id</div>
              <div className="adm-value">{normalized.userId ?? "—"}</div>
            </div>
            <div className="adm-row">
              <div className="adm-label">Projects</div>
              <div className="adm-value">{renderProjects(normalized.projectsCount)}</div>
            </div>
            <div className="adm-row">
              <div className="adm-label">Type</div>
              <div className="adm-value">{normalized.type ?? "—"}</div>
            </div>
            <div className="adm-row">
              <div className="adm-label">User Cost</div>
              <div className="adm-value">{renderCurrency(normalized.userCost)}</div>
            </div>
          </div>
        </div>
      </>
    );
  })();

  const footer = (
    <div className="adm-footer">
      <button
        type="button"
        className="adm-btn adm-btn-outline"
        onClick={handleDownloadJson}
        disabled={!normalized}
        title="Download JSON"
      >
        Download JSON
      </button>
      <button type="button" className="adm-btn adm-btn-primary" onClick={onClose}>
        Close
      </button>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={modalWidth || "min(92vw, 720px)"}
      maxWidth={modalWidth || "min(92vw, 720px)"}
      className={modalClassName}
      footer={footer}
    >
      <div className="agent-details-modal">
        {content}
      </div>
    </Modal>
  );
}

AgentDetailsModal.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func,
  agentId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  agentName: PropTypes.string,
  modalWidth: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  modalClassName: PropTypes.string,
};
