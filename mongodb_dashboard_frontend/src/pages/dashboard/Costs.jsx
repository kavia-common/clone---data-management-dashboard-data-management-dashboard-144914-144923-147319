import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import DataTable from "../../components/DataTable.jsx";
import AgentDetailsModal from "../../components/costs/AgentDetailsModal.jsx";
import { ViewCostDetailsModal } from "../../components/costs";
import { formatCurrencyAmount } from "../../utils/formatCurrency";
import { listLlmCosts } from "../../api/client";

/**
 * PUBLIC_INTERFACE
 * Costs page
 * - Keeps compact LLM costs table with inspector for large fields.
 * - Removes deprecated "View All" costs modal and focuses on compact inspector UX.
 */
export default function Costs() {
  const [allItems, setAllItems] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });

  // New Cost Details modal state
  const [costModalOpen, setCostModalOpen] = useState(false);
  const [costModalData, setCostModalData] = useState(null);

  // Agent details modal state
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [selectedAgentName, setSelectedAgentName] = useState("");

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

  // PUBLIC_INTERFACE
  function openCostDetails(row, fieldLabel = "Details") {
    // Build a minimal aggregated structure from a single row; fallback to mock handled in modal
    try {
      const userId = row?.user_id || row?.userId || row?.user || "user-unknown";
      const userName =
        row?.user_name ||
        row?.username ||
        row?.userName ||
        row?.user?.name ||
        "User";

      const projectId = row?.project_id || row?.projectId || row?.project?.id;
      const projectName = row?.project_name || row?.projectName || row?.project?.name || "Project";
      const totalCost = Number(row?.total_cost ?? row?.cost ?? 0);

      const mockProject = {
        projectId: projectId ?? "N/A",
        projectName,
        projectCost: Number.isFinite(totalCost) ? totalCost : 0,
        agents: [], // unknown at row level
      };

      const agg = {
        userId: String(userId),
        userName: String(userName),
        totalProjectCount: 1,
        totalCostUSD: Number.isFinite(totalCost) ? totalCost : 0,
        projects: [mockProject],
      };
      setCostModalData(agg);
    } catch {
      setCostModalData(null);
    }
    setCostModalOpen(true);
  }
  function closeCostDetails() {
    setCostModalOpen(false);
    setCostModalData(null);
  }

  function onAgentSelect({ agentId, agentName }) {
    try {
      console.debug("[Costs] Agent selected", { agentId, agentName });
    } catch {}
    // No other modal needs to be closed explicitly now
    setSelectedAgentId(agentId);
    setSelectedAgentName(agentName || "");
    setAgentModalOpen(true);
  }

  function closeAgentModal() {
    setAgentModalOpen(false);
    setSelectedAgentId(null);
    setSelectedAgentName("");
  }

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
      const txt = formatCurrencyAmount(value, { currency: "USD" });
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

  function renderCompact(value, fieldLabel = "Details", row = null) {
    if (Array.isArray(value)) {
      const len = value.length;
      if (len === 0) return "0 items";
      const previewMax = 2;
      const shown = value.slice(0, previewMax);
      const previewText = shown
        .map((v) => {
          if (v && typeof v === "object") {
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
            onClick={() => openCostDetails(row, fieldLabel)}
            aria-label={`View details for ${fieldLabel}`}
            title={`View details for ${fieldLabel}`}
            data-testid="costs-view-details"
          >
            View details
          </button>
        </div>
      );
    }
    if (value && typeof value === "object") {
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
            onClick={() => openCostDetails(row, fieldLabel)}
            aria-label={`View ${fieldLabel}`}
            title={`View ${fieldLabel}`}
            data-testid="costs-view"
          >
            View
          </button>
        </div>
      );
    }
    return renderText(value);
  }

  function buildColumnsFromSample(rows = []) {
    const sample = rows[0] || {};
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

    const nestedCandidates = ["users", "projects", "agents", "details", "metadata", "params", "prompt", "response"];
    const presentMain = preferredOrder.filter((k) => Object.prototype.hasOwnProperty.call(sample, k));
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
        priority: ["_id", "llm_model", "total_cost"].includes(k) ? 1 : 2,
      });
    });

    const nestedCols = [];
    nestedCandidates.forEach((name) => {
      if (Object.prototype.hasOwnProperty.call(sample, name)) {
        nestedCols.push({
          key: name,
          label: toLabel(name),
          render: (v, row) => renderCompact(v, toLabel(name), row),
          priority: 3,
        });
      }
    });

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

  const columns = useMemo(() => buildColumnsFromSample(items || []), [items]);

  return (
    <div>
      <Card
        title="Costs"
        subtitle="LLM usage cost records — compact view with expandable details"
      >
        <div className="toolbar" aria-label="Costs toolbar" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <input
            className="input-search"
            placeholder="Search costs..."
            aria-label="Search costs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div style={{ flex: 1 }} />
          {/* View All button removed per requirements */}
        </div>
        {error && <div className="error" role="alert">{error}</div>}
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

      {/* New cost details modal */}
      <ViewCostDetailsModal
        isOpen={costModalOpen}
        onClose={closeCostDetails}
        data={costModalData}
      />

      {/* Agent details modal - opened when an agent is selected from the details view */}
      <AgentDetailsModal
        open={agentModalOpen}
        onClose={closeAgentModal}
        agentId={selectedAgentId}
        agentName={selectedAgentName}
      />

      {/* Structured costs modal removed */}
    </div>
  );
}


