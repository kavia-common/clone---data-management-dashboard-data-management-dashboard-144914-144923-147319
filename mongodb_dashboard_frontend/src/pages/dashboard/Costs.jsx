import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import DataTable from "../../components/DataTable.jsx";
import Modal from "../../components/ui/Modal.jsx";
import DetailsViewer from "../../components/common/DetailsViewer.jsx";
import AgentDetailsModal from "../../components/costs/AgentDetailsModal.jsx";
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

  // Inspector modal state
  const [inspectOpen, setInspectOpen] = useState(false);
  const [inspectTitle, setInspectTitle] = useState("Details");
  const [inspectPayload, setInspectPayload] = useState(null);

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
  function openInspector(title, payload) {
    setInspectTitle(title);
    setInspectPayload(payload);
    setInspectOpen(true);
  }
  function closeInspector() {
    setInspectOpen(false);
    setInspectPayload(null);
  }

  function onAgentSelect({ agentId, agentName }) {
    try {
      console.debug("[Costs] Agent selected", { agentId, agentName });
    } catch {}
    setSelectedAgentId(agentId);
    setSelectedAgentName(agentName || "");
    setAgentModalOpen(true);
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

  function renderCompact(value, fieldLabel = "Details") {
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
            onClick={() => openInspector(fieldLabel, value)}
            aria-label={`View details for ${fieldLabel}`}
            title={`View details for ${fieldLabel}`}
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
          render: (v) => renderCompact(v, toLabel(name)),
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

      {/* Modal inspector for arrays/objects to avoid expanding inside table cells */}
      <Modal
        title={inspectTitle}
        open={inspectOpen}
        onClose={closeInspector}
        headerOffset={60}
      >
        <DetailsViewer
          data={inspectPayload}
          title={inspectTitle || "Cost details"}
          highlightKeys={[
            "timestamp",
            "model",
            "llm_model",
            "prompt_tokens",
            "completion_tokens",
            "total_tokens",
            "currency",
            "cost",
            "total_cost",
            "project",
            "project_id",
            "user",
            "user_id",
          ]}
          collapsedDepth={1}
          onClose={closeInspector}
          autoFocusClose
          compactLeft
          onAgentSelect={onAgentSelect}
        />
      </Modal>

      {/* Agent details modal - opened when an agent is selected from the details view */}
      <AgentDetailsModal
        open={agentModalOpen}
        onClose={() => setAgentModalOpen(false)}
        agentId={selectedAgentId}
        agentName={selectedAgentName}
      />

      {/* Structured costs modal removed */}
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
