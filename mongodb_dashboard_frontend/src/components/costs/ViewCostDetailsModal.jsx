import React from "react";
import ProjectDetail from "./ProjectDetail";

/**
 * PUBLIC_INTERFACE
 * ViewCostDetailsModal
 * Full-screen accessible overlay showing costs summary and raw JSON tabs. Self-contained and independent of shared Modal.
 *
 * Props:
 * - isOpen: boolean
 * - onClose: () => void
 * - data?: {
 *     userId: string;
 *     userName: string;
 *     totalProjectCount: number;
 *     totalCostUSD: number;
 *     projects: Array<{ projectId, projectName, projectCost, agents: Array<{ agentId, agentName, costByDate?: Record<string,number>, tokensByDate?: Record<string,number> }> }>;
 *   }
 */
export default function ViewCostDetailsModal({ isOpen, onClose, data }) {
  const [activeTab, setActiveTab] = React.useState("summary");
  const [copyStatus, setCopyStatus] = React.useState("");

  React.useEffect(() => {
    if (isOpen) setActiveTab("summary");
  }, [isOpen]);

  const MOCK_DATA = React.useMemo(
    () => ({
      userId: "user-789",
      userName: "Super Admin User",
      totalProjectCount: 3,
      totalCostUSD: 1.8975,
      projects: [
        {
          projectId: 10,
          projectName: "Marketing Automation",
          projectCost: 0.394569,
          agents: [
            {
              agentId: 1,
              agentName: "Analysis Bot #1",
              costByDate: { "2024-10-01": 0.12, "2024-10-02": 0.274569 },
              tokensByDate: { "2024-10-01": 15000, "2024-10-02": 35000 },
            },
          ],
        },
        {
          projectId: 18,
          projectName: "Customer Support Triage",
          projectCost: 0.652131,
          agents: [
            {
              agentId: 2,
              agentName: "Routing Agent #1",
              costByDate: { "2024-10-01": 0.35, "2024-10-02": 0.302131 },
              tokensByDate: { "2024-10-01": 40000, "2024-10-02": 38000 },
            },
            {
              agentId: 3,
              agentName: "Documentation Bot #2",
              costByDate: { "2024-10-03": 0.032, "2024-10-04": 0.032295 },
              tokensByDate: { "2024-10-03": 3200, "2024-10-04": 3300 },
            },
          ],
        },
        { projectId: 22, projectName: "Internal HR Assistant", projectCost: 0.8508, agents: [] },
      ],
    }),
    []
  );

  const costData = data || MOCK_DATA;
  const rawJson = React.useMemo(() => {
    try {
      return JSON.stringify(costData, null, 2);
    } catch {
      return "Unable to render JSON";
    }
  }, [costData]);

  const handleCopy = React.useCallback(() => {
    try {
      navigator.clipboard.writeText(rawJson).then(
        () => setCopyStatus("Copied!"),
        () => {
          fallbackCopy(rawJson);
          setCopyStatus("Copied!");
        }
      );
    } catch {
      fallbackCopy(rawJson);
      setCopyStatus("Copied!");
    } finally {
      setTimeout(() => setCopyStatus(""), 1600);
    }
  }, [rawJson]);

  function fallbackCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch {
      // noop
    }
  }

  // Close on ESC
  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="cost-details-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="View Cost Details"
      data-testid="view-cost-details-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.6)",
        padding: 16,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        className="cost-details-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-surface, #fff)",
          width: "min(96vw, 960px)",
          maxHeight: "90vh",
          borderRadius: 16,
          boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          className="cdm-header sticky-header"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: 16,
            borderBottom: "1px solid var(--border-subtle)",
            background: "var(--bg-surface, #fff)",
            position: "sticky",
            top: 0,
            zIndex: 2,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: "var(--text-primary)" }}>
            Cost Details for <span style={{ color: "#2563EB" }}>{costData?.userName || "User"}</span>
          </h2>
          <button
            onClick={onClose}
            aria-label="Close modal"
            data-testid="cdm-close"
            className="btn btn-ghost"
            style={{
              height: 36,
              width: 36,
              display: "grid",
              placeItems: "center",
              border: "1px solid var(--border-subtle)",
              borderRadius: 10,
            }}
            title="Close"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div
          className="cdm-tabs"
          style={{
            display: "flex",
            gap: 8,
            borderBottom: "1px solid var(--border-subtle)",
            padding: "8px 16px",
            background: "var(--bg-surface, #fff)",
          }}
        >
          <button
            onClick={() => setActiveTab("summary")}
            className="btn btn-ghost"
            aria-pressed={activeTab === "summary"}
            data-testid="cdm-tab-summary"
            style={{
              background: activeTab === "summary" ? "rgba(15,23,42,0.04)" : "transparent",
              color: activeTab === "summary" ? "var(--text-primary)" : "var(--text-secondary)",
              fontWeight: activeTab === "summary" ? 800 : 600,
              padding: "8px 12px",
              borderRadius: 8,
            }}
          >
            Summary View
          </button>
          <button
            onClick={() => setActiveTab("json")}
            className="btn btn-ghost"
            aria-pressed={activeTab === "json"}
            data-testid="cdm-tab-json"
            style={{
              background: activeTab === "json" ? "rgba(15,23,42,0.04)" : "transparent",
              color: activeTab === "json" ? "var(--text-primary)" : "var(--text-secondary)",
              fontWeight: activeTab === "json" ? 800 : 600,
              padding: "8px 12px",
              borderRadius: 8,
            }}
          >
            Raw JSON
          </button>
        </div>

        {/* Body */}
        <div
          className="cdm-body"
          style={{
            padding: 16,
            overflowY: "auto",
            flex: 1,
            background: "#f9fafb",
          }}
        >
          {activeTab === "summary" ? (
            <div style={{ display: "grid", gap: 12 }}>
              {/* Summary card */}
              <div
                style={{
                  background: "linear-gradient(90deg, rgba(37,99,235,0.08), rgba(249,250,251,1))",
                  padding: 16,
                  borderRadius: 12,
                  boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
                  border: "1px solid #DBEAFE",
                }}
              >
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#1D4ED8" }}>
                  User ID:
                  <span
                    style={{
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      color: "#1E3A8A",
                      marginLeft: 8,
                    }}
                  >
                    {costData?.userId || "—"}
                  </span>
                </p>
                <h3 style={{ margin: "6px 0 0 0", fontSize: 18, fontWeight: 800, color: "#1E3A8A" }}>
                  Total Account Cost:{" "}
                  <span style={{ fontSize: 24, fontWeight: 900 }}>
                    {(() => {
                      const n = Number(costData?.totalCostUSD || 0);
                      try {
                        return new Intl.NumberFormat(undefined, {
                          style: "currency",
                          currency: "USD",
                          maximumFractionDigits: 6,
                        }).format(n);
                      } catch {
                        return `$${n.toFixed(4)}`;
                      }
                    })()}
                  </span>
                </h3>
                <p style={{ margin: "4px 0 0 0", fontSize: 14, color: "#1E40AF", fontWeight: 600 }}>
                  {Number(costData?.totalProjectCount || 0)} Projects Tracked
                </p>
              </div>

              <h3
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  color: "var(--text-primary)",
                  borderBottom: "1px solid var(--border-subtle)",
                  paddingBottom: 8,
                  margin: 0,
                }}
              >
                Project Breakdown
              </h3>

              {(Array.isArray(costData?.projects) ? costData.projects : []).map((p) => (
                <ProjectDetail key={String(p.projectId)} project={p} />
              ))}
            </div>
          ) : (
            <div style={{ position: "relative" }}>
              <button
                onClick={handleCopy}
                className="btn btn-primary"
                data-testid="cdm-copy-json"
                style={{
                  position: "absolute",
                  top: 12,
                  right: 12,
                  fontSize: 12,
                  padding: "6px 10px",
                  borderRadius: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
                title="Copy JSON"
              >
                {copyStatus || "Copy JSON"}
              </button>
              <pre
                style={{
                  background: "#0b1020",
                  color: "#e6edf3",
                  padding: 16,
                  borderRadius: 12,
                  fontSize: 12,
                  overflowX: "auto",
                  minHeight: 240,
                  boxShadow: "inset 0 1px 2px rgba(0,0,0,0.25)",
                  border: "1px solid #334155",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {rawJson}
              </pre>
              {copyStatus ? (
                <div
                  style={{
                    position: "absolute",
                    top: 16,
                    right: 116,
                    background: "#10B981",
                    color: "#fff",
                    borderRadius: 6,
                    padding: "2px 8px",
                    boxShadow: "0 2px 8px rgba(16,185,129,0.3)",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {copyStatus}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
