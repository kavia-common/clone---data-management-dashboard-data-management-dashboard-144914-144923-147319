import React from "react";
import DateDetails from "./DateDetails";

import { renderCreditsWithUsd, usdToCredits } from "../../utils/currency";

/**
 * PUBLIC_INTERFACE
 * ProjectDetail
 * Expanding card that shows project summary and agents list with date-wise costs/tokens.
 *
 * Props:
 * - project: {
 *     projectId: number|string,
 *     projectName: string,
 *     projectCost: number,
 *     agents: Array<{ agentId, agentName, costByDate?: Record<string,number>, tokensByDate?: Record<string,number>, cost?: number|string, price?: number|string, amount?: number|string }>
 *   }
 */
export default function ProjectDetail({ project }) {
  const [open, setOpen] = React.useState(false);

  const totalCost = Number(project?.projectCost || 0);
  const agents = Array.isArray(project?.agents) ? project.agents : [];

  // Safe numeric parser for various inputs, including currency strings
  const toNumber = React.useCallback((v) => {
    if (v == null) return 0;
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (typeof v === "string") {
      const s = v.replace(/[$,]/g, "");
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : 0;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }, []);

  // Determine an agent's total cost:
  // - Prefer explicit fields: cost | price | amount
  // - Otherwise, sum values of costByDate if present
  const getAgentTotalCost = React.useCallback(
    (agent) => {
      if (!agent || typeof agent !== "object") return 0;
      const explicit =
        agent.cost != null ? agent.cost :
        agent.price != null ? agent.price :
        agent.amount != null ? agent.amount :
        null;

      if (explicit != null) return toNumber(explicit);

      const cbd = agent.costByDate;
      if (cbd && typeof cbd === "object") {
        try {
          return Object.values(cbd).reduce((sum, v) => sum + toNumber(v), 0);
        } catch {
          return 0;
        }
      }
      return 0;
    },
    [toNumber]
  );

  // Filter agents to only those with cost > 0
  const billableAgents = React.useMemo(() => {
    if (!agents.length) return [];
    return agents.filter((a) => getAgentTotalCost(a) > 0);
  }, [agents, getAgentTotalCost]);

  return (
    <div
      className="project-detail"
      style={{
        marginBottom: 12,
        border: "1px solid var(--border-subtle, #E5E7EB)",
        borderRadius: 12,
        overflow: "hidden",
        background: "var(--bg-surface, #fff)",
        boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
      }}
      data-testid={`project-${project?.projectId}`}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`project-panel-${project?.projectId}`}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: 14,
          background: "#F8FAFC",
          border: "none",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)" }}>
            Project #{String(project?.projectId ?? "—")}: {project?.projectName || "Untitled"}
          </span>
          <div
            title={`User Cost: ${renderCreditsWithUsd(totalCost, { maximumFractionDigits: 6 }).split("•")[0].trim()}; Credits Used: ${renderCreditsWithUsd(totalCost, { maximumFractionDigits: 6 }).split("•").slice(-1)[0].replace("Credits:", "").trim()}`}
            className="flex flex-col items-start"
          >
            <span className="text-gray-900 font-semibold">
              {renderCreditsWithUsd(totalCost, { maximumFractionDigits: 6 }).split("•")[0].trim()}
            </span>
            <span className="mt-1 text-sm text-gray-500 leading-5">
              Credits Used:<br />
              <strong className="text-gray-900">
                {renderCreditsWithUsd(totalCost, { maximumFractionDigits: 6 }).split("•").slice(-1)[0].replace("Credits:", "").trim()}
              </strong>
            </span>
          </div>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#2563EB",
              background: "#EFF6FF",
              borderRadius: 999,
              padding: "2px 8px",
            }}
            title={`${billableAgents.length} billable agent${billableAgents.length === 1 ? "" : "s"}`}
          >
            {billableAgents.length} Agent{billableAgents.length === 1 ? "" : "s"}
          </span>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            style={{ color: "var(--text-tertiary)", transform: open ? "rotate(180deg)" : "none", transition: ".2s" }}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
      </button>

      <div
        id={`project-panel-${project?.projectId}`}
        style={{
          transition: "max-height .3s ease",
          overflow: "hidden",
          maxHeight: open ? 2000 : 0,
        }}
      >
        <div style={{ padding: 14 }}>
          {billableAgents.length ? (
            <div style={{ display: "grid", gap: 10 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-secondary)", borderBottom: "1px solid var(--border-subtle)", paddingBottom: 8 }}>
                Agents Involved:
              </h3>
              {billableAgents.map((agent) => (
                <div
                  key={agent.agentId}
                  style={{
                    background: "#F8FAFC",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 10,
                    padding: 12,
                  }}
                >
                  <h4 style={{ margin: 0, marginBottom: 8, fontSize: 14, fontWeight: 800, color: "#1D4ED8" }}>
                    Agent #{String(agent.agentId)}: {agent.agentName || "Agent"}
                  </h4>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr",
                      gap: 12,
                    }}
                  >
                    <DateDetails title="Costs By Date" data={agent.costByDate} />
                    <DateDetails title="Tokens By Date" data={agent.tokensByDate} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ textAlign: "center", fontStyle: "italic", margin: "6px 0" }}>
              No billable agents for this item.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
