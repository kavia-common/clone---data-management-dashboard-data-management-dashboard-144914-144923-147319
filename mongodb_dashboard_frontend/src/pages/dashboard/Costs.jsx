import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import DataTable from "../../components/DataTable.jsx";
import Modal from "../../components/ui/Modal.jsx";
import { formatUsdUpTo8 } from "../../components/utils/numberFormat";
import { listLlmCosts } from "../../api/client";
import useLlmCostsSummary from "../../hooks/useLlmCostsSummary";
import useLlmCostsHierarchy from "../../hooks/useLlmCostsHierarchy";

/**
 * PUBLIC_INTERFACE
 * Costs page
 * Refactored to avoid table breaking by:
 * - Limiting columns to main fields only (no auto-expanding to hundreds of columns).
 * - Summarizing arrays/objects inline with a compact preview (first 1–2 items) and a “View All” modal for details.
 * - Capping cell width with ellipsis and adding title-based tooltips for long content.
 * - Keeping responsive behavior aligned with Users/Sessions modules.
 */
export default function Costs() {
  const [allItems, setAllItems] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });

  // Modal state for inspecting large arrays/objects without breaking table layout
  const [inspectOpen, setInspectOpen] = useState(false);
  const [inspectTitle, setInspectTitle] = useState("Details");
  const [inspectPayload, setInspectPayload] = useState(null);

  // Field hints
  const dateFieldHints = useMemo(
    () =>
      new Set([
        "timestamp",
        "created_at",
        "updated_at",
        "createdAt",
        "updatedAt",
        "date",
      ]),
    []
  );
  const currencyFieldHints = useMemo(
    () => new Set(["total_cost", "cost", "organization_cost"]),
    []
  );
  const numericPrettyHints = useMemo(
    () =>
      new Set(["total_tokens", "input_tokens", "output_tokens", "tokens", "count"]),
    []
  );

  function toLabel(k) {
    return k === "_id"
      ? "ID"
      : k.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  }

  // Open modal inspector with pretty JSON
  function openInspector(title, payload) {
    setInspectTitle(title);
    setInspectPayload(payload);
    setInspectOpen(true);
  }
  function closeInspector() {
    setInspectOpen(false);
    setInspectPayload(null);
  }

  // Renderers with capped width and tooltips
  const renderText = (value) => {
    const text = value == null || value === "" ? "—" : String(value);
    return (
      <span
        title={text}
        style={{
          display: "inline-block",
          maxWidth: 280,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          verticalAlign: "middle",
        }}
      >
        {text}
      </span>
    );
  };

  const renderNumber = (value, key) => {
    if (value == null || value === "") return "—";
    if (currencyFieldHints.has(key) && typeof value === "number") {
      const txt = formatUsdUpTo8(value);
      return (
        <span className="amount-positive" title={txt} style={{ whiteSpace: "nowrap" }}>
          {txt}
        </span>
      );
    }
    if (typeof value === "number" && (numericPrettyHints.has(key) || /token|count|total/i.test(key))) {
      const txt = value.toLocaleString();
      return (
        <span title={txt} style={{ whiteSpace: "nowrap" }}>
          {txt}
        </span>
      );
    }
    return renderText(value);
  };

  const renderDate = (value) => {
    if (!value) return "—";
    try {
      const txt = new Date(value).toLocaleString();
      return <span title={txt}>{txt}</span>;
    } catch {
      return renderText(value);
    }
  };

  // Compact preview for arrays/objects with modal "View All"
  function renderCompact(value, fieldLabel = "Details") {
    if (Array.isArray(value)) {
      const len = value.length;
      if (len === 0) return "0 items";
      const previewMax = 2;
      const shown = value.slice(0, previewMax);
      const previewText = shown
        .map((v) => {
          if (v && typeof v === "object") {
            // prefer a name/id if present
            return v.name || v.id || v._id || JSON.stringify(v);
          }
          return String(v);
        })
        .join(", ");
      const overflow = len > previewMax ? ` +${len - previewMax} more` : "";
      const summary = `${previewText}${overflow}`;
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span
            title={summary}
            style={{
              display: "inline-block",
              maxWidth: 320,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {summary}
          </span>
          <button
            className="btn btn-ghost"
            style={{ padding: "4px 8px", height: 28 }}
            onClick={() => openInspector(fieldLabel, value)}
            aria-label={`View all ${fieldLabel}`}
            title={`View all ${fieldLabel}`}
          >
            View All
          </button>
        </div>
      );
    }
    if (value && typeof value === "object") {
      // summarize object keys
      const keys = Object.keys(value);
      const shown = keys.slice(0, 2);
      const summary = `${shown.join(", ")}${keys.length > 2 ? ` +${keys.length - 2} more` : ""}`;
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span title={summary} style={{ maxWidth: 320, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "inline-block" }}>
            {summary || "—"}
          </span>
          <button
            className="btn btn-ghost"
            style={{ padding: "4px 8px", height: 28 }}
            onClick={() => openInspector(fieldLabel, value)}
            aria-label={`View ${fieldLabel}`}
            title={`View ${fieldLabel}`}
          >
            View
          </button>
        </div>
      );
    }
    return renderText(value);
  }

  // Derive a stable, minimal set of main fields (no exploding columns)
  function buildColumnsFromSample(rows = []) {
    const sample = rows[0] || {};
    // Choose a conservative main field set to mirror Users/Sessions style
    // We pick commonly expected cost fields if present; otherwise fall back to a few safe keys.
    const preferredOrder = [
      "_id",
      "tenant_id",
      "project_id",
      "user_id",
      "llm_model",
      "total_cost",
      "total_tokens",
      "timestamp",
      "created_at",
      "updated_at",
    ];

    // Detect nested heavy fields to summarize into a single column each
    const nestedCandidates = ["users", "projects", "agents", "details", "metadata", "params", "prompt", "response"];

    // Gather present main fields
    const presentMain = preferredOrder.filter((k) => Object.prototype.hasOwnProperty.call(sample, k));

    // Always include _id if present; ensure at least ID + one more field if exists
    const mainFields = presentMain.length ? presentMain : Object.keys(sample).slice(0, 5);

    const cols = [];

    mainFields.forEach((k) => {
      cols.push({
        key: k,
        label: toLabel(k),
        render: (v, row) => {
          const val = v ?? row?.[k];
          if (val == null) return "—";
          if (dateFieldHints.has(k)) return renderDate(val);
          if (typeof val === "number") return renderNumber(val, k);
          return renderText(val);
        },
        // Assign priorities to allow responsive hiding if needed
        priority: ["_id", "llm_model", "total_cost"].includes(k) ? 1 : 2,
      });
    });

    // Add compact columns for nested candidates that exist on sample; do not add more than 3 nested columns
    const nestedCols = [];
    nestedCandidates.forEach((name) => {
      if (Object.prototype.hasOwnProperty.call(sample, name)) {
        nestedCols.push({
          key: name,
          label: toLabel(name),
          render: (v) => renderCompact(v, toLabel(name)),
          priority: 3,
        });
      }
    });

    // Limit nested columns to avoid width blow-up
    cols.push(...nestedCols.slice(0, 3));

    return cols.length ? cols : [{ key: "_id", label: "ID" }];
  }

  async function load(page = 1, limit = meta.limit || 10) {
    setLoading(true);
    setError("");
    try {
      const res = await listLlmCosts({ page, limit });
      const arr = res?.items ?? (Array.isArray(res) ? res : []);
      setAllItems(arr);
      setItems(arr);
      setMeta({ page: res?.meta?.page || page, limit: res?.meta?.limit || limit, total: res?.meta?.total ?? arr.length });
    } catch (e) {
      setAllItems([]);
      setItems([]);
      setError(e?.response?.data?.message || e?.message || "Failed to load LLM costs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Text search across selected fields (safe and simple)
  useEffect(() => {
    const q = (query || "").trim().toLowerCase();
    if (!q) {
      setItems(allItems);
      return;
    }
    const filtered = (allItems || []).filter((doc) => {
      return Object.entries(doc || {}).some(([k, v]) => {
        if (v == null) return false;
        try {
          const s =
            typeof v === "object"
              ? JSON.stringify(v)
              : String(v);
          return s.toLowerCase().includes(q);
        } catch {
          return false;
        }
      });
    });
    setItems(filtered);
  }, [query, allItems]);

  // Build columns once data is present
  const columns = useMemo(() => buildColumnsFromSample(items || []), [items]);

  const { data: summary, loading: summaryLoading, error: summaryError } = useLlmCostsSummary();

  const { data: hierarchy, loading: hierarchyLoading, error: hierarchyError } = useLlmCostsHierarchy();

  return (
    <div>
      <Card title="LLM Costs Summary" subtitle="Aggregated totals derived from type field">
        {summaryLoading ? (
          <div className="text-gray-400 text-sm">Loading summary...</div>
        ) : summaryError ? (
          <div className="text-red-500 text-sm">Failed to load summary</div>
        ) : (
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div>
              <div className="text-xs text-gray-500">User Cost</div>
              <div className="text-lg font-semibold">
                {summary.currency} {Number(summary.user_cost || 0).toFixed(4)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Project Cost</div>
              <div className="text-lg font-semibold">
                {summary.currency} {Number(summary.project_cost || 0).toFixed(4)}
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card title="Per-user and project breakdown" subtitle="User -> Project -> Agent hierarchy with per-date tokens and costs">
        {hierarchyLoading ? (
          <div className="text-gray-400 text-sm">Loading breakdown...</div>
        ) : hierarchyError ? (
          <div className="text-red-500 text-sm">Failed to load breakdown</div>
        ) : !Array.isArray(hierarchy) || hierarchy.length === 0 ? (
          <div className="text-gray-500 text-sm">No hierarchical data available.</div>
        ) : (
          <div className="space-y-4">
            {hierarchy.map((user) => (
              <div key={user.user_id} className="rounded border">
                <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
                  <div className="font-semibold text-gray-800">User: {user.user_id}</div>
                  <div className="text-sm text-gray-700">Total: {user.user_cost}</div>
                </div>
                <div className="p-4 space-y-3">
                  {(user.projects || []).map((proj, idx) => (
                    <div key={`${user.user_id}-${idx}`} className="rounded border">
                      <div className="px-3 py-2 bg-white flex items-center justify-between">
                        <div className="text-gray-800">
                          Project: <span className="font-medium">{String(proj.project_id)}</span>
                        </div>
                        <div className="text-sm">Total: {proj.project_cost}</div>
                      </div>
                      <div className="px-3 pb-3">
                        {(proj.agents || []).map((agent, aidx) => (
                          <details key={`${user.user_id}-${idx}-a-${aidx}`} className="border rounded mt-2">
                            <summary className="px-3 py-2 cursor-pointer bg-gray-50 hover:bg-gray-100 flex items-center justify-between">
                              <span className="text-gray-800">
                                Agent: <span className="font-medium">{agent.agent_name || "Unknown"}</span>
                              </span>
                              <span className="text-sm">Total: {agent.total_cost}</span>
                            </summary>
                            <div className="p-3 bg-white">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <div className="font-semibold mb-1">Costs by date</div>
                                  {agent.costs_by_date && Object.keys(agent.costs_by_date).length > 0 ? (
                                    <ul className="text-sm space-y-1">
                                      {Object.entries(agent.costs_by_date).map(([date, cost]) => (
                                        <li key={date} className="flex justify-between">
                                          <span className="text-gray-600">{date}</span>
                                          <span className="font-mono">{cost}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <div className="text-sm text-gray-500">No per-date cost data</div>
                                  )}
                                </div>
                                <div>
                                  <div className="font-semibold mb-1">Tokens by date</div>
                                  {agent.tokens_by_date && Object.keys(agent.tokens_by_date).length > 0 ? (
                                    <ul className="text-sm space-y-1">
                                      {Object.entries(agent.tokens_by_date).map(([date, tok]) => (
                                        <li key={date} className="flex justify-between">
                                          <span className="text-gray-600">{date}</span>
                                          <span className="font-mono">
                                            in: {tok?.input_tokens ?? 0} | out: {tok?.output_tokens ?? 0}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <div className="text-sm text-gray-500">No per-date token data</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </details>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Costs"
        subtitle="LLM usage cost records — compact view with expandable details"
      >
        <div className="toolbar" aria-label="Costs toolbar">
          <input
            className="input-search"
            placeholder="Search costs..."
            aria-label="Search costs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="spacer" />
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {/* DataTable cells already respect ellipsis on small screens via CSS; we cap content and add title tooltips here */}
        <DataTable
          columns={columns}
          data={items}
          loading={loading}
          pageSize={meta.limit || 10}
          initialPage={meta.page || 1}
          serverTotal={meta.total}
          fetchPage={async (page, limit) => {
            await load(page, limit);
          }}
          paginationTitle="Cost records pages"
        />
      </Card>

      {/* Modal inspector for arrays/objects to avoid expanding inside table cells */}
      <Modal
        title={inspectTitle}
        open={inspectOpen}
        onClose={closeInspector}
        footer={
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={closeInspector}>Close</button>
          </div>
        }
      >
        <div style={{ whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 12 }}>
          {inspectPayload == null ? "—" : safePretty(inspectPayload)}
        </div>
      </Modal>
    </div>
  );
}

/**
 * PUBLIC_INTERFACE
 * Pretty print helper for modal payload display.
 */
function safePretty(payload) {
  try {
    if (typeof payload === "string") return payload;
    return JSON.stringify(payload, null, 2);
  } catch {
    try {
      return String(payload);
    } catch {
      return "Unable to render payload";
    }
  }
}
