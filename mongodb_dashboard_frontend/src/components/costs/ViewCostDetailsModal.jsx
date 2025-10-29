import React from "react";
import ProjectDetail from "./ProjectDetail";

import { renderCreditsWithUsd } from "../../utils/currency";
import { CREDITS_PER_USD } from "../../utils/currency";
import { formatLabel } from "../../utils/formatLabel";
import { getUserBasic } from "../../api/users";

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
 *     // May include any of the following (numeric or numeric strings):
 *     // - totalCostUSD | total_usd | total_cost | totalCost | cost | price | amount
 *     // - total_credits | user_credits | project_credits | credits
 *     projects: Array<{ projectId, projectName, projectCost, agents: Array<{ agentId, agentName, costByDate?: Record<string,number>, tokensByDate?: Record<string,number> }> }>;
 *   }
 */
export default function ViewCostDetailsModal({ isOpen, onClose, data }) {
  const [activeTab, setActiveTab] = React.useState("summary");
  const [copyStatus, setCopyStatus] = React.useState("");
  // User name fetch state
  const [userName, setUserName] = React.useState(data?.userName || "");
  const [userNameLoading, setUserNameLoading] = React.useState(false);
  const [userNameError, setUserNameError] = React.useState(null);

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

  // Fetch user name when modal opens or when userId changes
  React.useEffect(() => {
    let ignore = false;
    async function loadName() {
      const id = costData?.userId;
      if (!isOpen || !id) {
        setUserName(data?.userName || "");
        setUserNameLoading(false);
        setUserNameError(null);
        return;
      }
      // If caller already provided a name, prefer it without fetching.
      if (data?.userName) {
        setUserName(String(data.userName));
        setUserNameLoading(false);
        setUserNameError(null);
        return;
      }
      try {
        setUserNameLoading(true);
        setUserNameError(null);
        const resp = await getUserBasic(String(id));
        if (ignore) return;
        setUserName(resp?.name || "");
      } catch (err) {
        if (!ignore) {
          // Gracefully degrade to "Unknown user"
          setUserName("");
          setUserNameError(err?.response?.data?.message || err?.message || "Failed to load");
        }
      } finally {
        if (!ignore) setUserNameLoading(false);
      }
    }
    loadName();
    return () => { ignore = true; };
  }, [isOpen, costData?.userId, data?.userName]);

  // Robust numeric parser for USD/credits fields (handles numeric strings like "0.12" or "$0.12")
  const toNumber = React.useCallback((v) => {
    if (v == null || v === "") return 0;
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (typeof v === "string") {
      const s = v.replace(/[$,]/g, "");
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : 0;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }, []);

  /**
   * Returns a normalized pair of { usd, credits } for top-level summary.
   * - Prefers USD-like fields; when present, compute credits from USD.
   * - If only credits-like fields exist, back-compute USD from credits using the configured rate.
   */
  // Select top-level USD and credits, explicitly preferring backend-provided creditsUsed/credits_used
  const topLevelAmounts = React.useMemo(() => {
    // Prefer API-provided credits first for alignment with backend calculation
    const preferredCreditsRaw = costData?.creditsUsed ?? costData?.credits_used ?? null;
    const preferredCredits =
      typeof preferredCreditsRaw === "string" ? Number(preferredCreditsRaw) : preferredCreditsRaw;

    // Fallback: derive from available USD-like fields
    const usdCandidates = [
      "totalCostUSD",
      "total_usd",
      "total_cost",
      "totalCost",
      "usd",
      "usd_cost",
      "cost",
      "price",
      "amount",
      "user_cost",
      "project_cost",
      "charge",
    ];

    let usd = 0;
    for (const k of usdCandidates) {
      if (Object.prototype.hasOwnProperty.call(costData || {}, k)) {
        usd = toNumber(costData[k]);
        if (usd) break;
      }
    }

    if (Number.isFinite(preferredCredits) && preferredCredits > 0) {
      // Back-compute USD from credits using configured rate to keep display consistent
      const computedUsd = preferredCredits / CREDITS_PER_USD;
      return { usd: computedUsd, credits: preferredCredits };
    }

    if (usd > 0) {
      return { usd, credits: Math.round(usd * CREDITS_PER_USD) };
    }

    // Fallback legacy credits keys if present (e.g., total_credits)
    const legacyCredits =
      toNumber(costData?.total_credits) ||
      toNumber(costData?.user_credits) ||
      toNumber(costData?.project_credits) ||
      toNumber(costData?.credits) ||
      0;

    if (legacyCredits > 0) {
      const computedUsd = legacyCredits / CREDITS_PER_USD;
      return { usd: computedUsd, credits: legacyCredits };
    }

    return { usd: 0, credits: 0 };
  }, [costData, toNumber]);

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
          /* Add subtle border to delineate white card on white backgrounds */
          border: "1px solid var(--border-subtle, #e5e7eb)",
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
            className="btn-modal-close compact"
            title="Close"
          >
            Close
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
            /* Use app background token; fallback ensures parity with Ocean Professional theme */
            background: "var(--bg-canvas, var(--ocean-bg, #f9fafb))",
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
                <p style={{ margin: "6px 0 0 0", fontSize: 12, fontWeight: 700, color: "#0F172A" }}>
                  User Name:
                  <span
                    style={{
                      marginLeft: 8,
                      /* Use theme secondary for loading/secondary text; primary for value */
                      color: userNameLoading ? "var(--text-secondary, #374151)" : "var(--text-primary, #111827)",
                      fontWeight: 800,
                    }}
                    title={userNameError ? String(userNameError) : undefined}
                  >
                    {userNameLoading
                      ? "Loading name…"
                      : (userName?.trim()
                          ? userName
                          : (costData?.userName?.trim()
                              ? costData.userName
                              : "Not available"))}
                  </span>
                </p>
                <div
                  title={`User Cost: ${renderCreditsWithUsd(topLevelAmounts.usd, { maximumFractionDigits: 6 }).split("•")[0].trim()}; Credits Used: ${topLevelAmounts?.credits?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || "—"}`}
                  className="flex flex-col items-start"
                  style={{ marginTop: 6 }}
                >
                  <span className="text-gray-900 font-semibold" style={{ fontSize: 18, color: "var(--text-primary, #111827)" }}>
                    {renderCreditsWithUsd(topLevelAmounts.usd, { maximumFractionDigits: 6 }).split("•")[0].trim()}
                  </span>
                  <span className="mt-1 text-sm text-gray-500 leading-5" style={{ color: "var(--text-secondary, #374151)" }}>
                    Credits Used:<br />
                    <strong className="text-gray-900" style={{ color: "var(--text-primary, #111827)" }}>
                      {topLevelAmounts?.credits?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || "—"}
                    </strong>
                  </span>
                </div>
                <p style={{ margin: "4px 0 0 0", fontSize: 14, color: "#1E40AF", fontWeight: 600 }}>
                  {Number(costData?.totalProjectCount || 0)} Projects Tracked
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 12,
                  borderBottom: "1px solid var(--border-subtle)",
                  paddingBottom: 8,
                }}
              >
                <h3
                  style={{
                    fontSize: 16,
                    fontWeight: 800,
                    color: "var(--text-primary)",
                    margin: 0,
                  }}
                >
                  Project Breakdown
                </h3>

                {/* Credits used shown adjacent to project cost summary */}
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    color: "#1F2937",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  <span style={{ color: "var(--text-secondary, #374151)", fontWeight: 700 }}>Credits used</span>
                  <span
                    data-testid="credits-used-inline"
                    style={{
                      color: "var(--text-primary, #111827)",
                      background: "rgba(37,99,235,0.06)",
                      border: "1px solid #DBEAFE",
                      padding: "2px 8px",
                      borderRadius: 8,
                      fontVariantNumeric: "tabular-nums",
                    }}
                    title="Credits used (from API, with computed fallback)"
                  >
                    {(() => {
                      const credits = topLevelAmounts?.credits || 0;
                      return credits
                        ? credits.toLocaleString(undefined, { maximumFractionDigits: 0 })
                        : (costData?.userName === "Loading..." ? "Loading…" : "—");
                    })()}
                  </span>
                </div>
              </div>

              {(Array.isArray(costData?.projects) ? costData.projects : []).map((p) => (
                <ProjectDetail key={String(p.projectId)} project={p} />
              ))}

              {/* Example: If we decide to show any extra details from a dynamic object, format labels only for display */}
              {costData?.extraDetails && typeof costData.extraDetails === 'object' ? (
                <div
                  style={{
                    marginTop: 8,
                    borderTop: '1px solid var(--border-subtle)',
                    paddingTop: 8,
                    display: 'grid',
                    gridTemplateColumns: 'minmax(140px, 200px) 1fr',
                    gap: '6px 10px',
                  }}
                >
                  {Object.entries(costData.extraDetails).map(([k, v]) => (
                    <React.Fragment key={k}>
                      <div style={{ color: 'var(--text-tertiary)', fontWeight: 600, fontSize: 12 }}>
                        {formatLabel(k)}
                      </div>
                      <div style={{ whiteSpace: typeof v === 'object' ? 'pre-wrap' : 'normal', fontFamily: typeof v === 'object' ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' : 'inherit', fontSize: typeof v === 'object' ? 12 : 14 }}>
                        {typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)}
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              ) : null}
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
