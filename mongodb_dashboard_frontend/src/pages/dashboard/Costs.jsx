import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import DataTable from "../../components/DataTable.jsx";
import Modal from "../../components/ui/Modal.jsx";
import TreeView from "../../components/TreeView.jsx";

import { renderCreditsWithUsd } from "../../utils/currency";
import { listLlmCosts } from "../../api";


/**
 * PUBLIC_INTERFACE
 * Costs page
 * - Keeps compact LLM costs table with inspector for large fields.
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
  // Normalize currency-like field names across various API shapes.
  // Handles: snake_case, camelCase, and *_usd variants.
  const CURRENCY_FIELDS = useMemo(
    () =>
      new Set(
        [
          "total_cost",
          "totalcost",
          "cost",
          "organization_cost",
          "organizationcost",
          "price",
          "amount",
          "usd",
          "usd_cost",
          "total_usd",
          "totalusd",
          "amount_usd",
          "charge",
        ].map((s) => s.toLowerCase())
      ),
    []
  );

  function isCurrencyKey(key) {
    const k = String(key || "").toLowerCase();
    if (CURRENCY_FIELDS.has(k)) return true;
    // Also treat anything ending with _usd or usd_... as currency-like
    if (/_usd\b|\busd_|\busd$/i.test(k)) return true;
    return false;
  }
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

    // Coerce to number when possible (e.g., "0.123", "$0.12")
    const num = typeof value === "number" ? value : Number(String(value).replace(/[$,]/g, ""));
    const isFiniteNum = Number.isFinite(num);

    if (isCurrencyKey(key) && isFiniteNum) {
      return (
        <span className="amount-positive" style={{ whiteSpace: "nowrap" }}>
          {renderCreditsWithUsd(num)}
        </span>
      );
    }

    if (isFiniteNum && (numericPrettyHints.has(key) || /token|count|total/i.test(String(key)))) {
      const txt = num.toLocaleString();
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

  async function load(page = 1, limit = meta.limit || 10, sortKey, sortDir) {
    /**
     * Loads costs with optional server-side sorting.
     * When sortKey is provided, we pass `sort` param to backend using the format:
     *  - asc: field
     *  - desc: -field
     */
    setLoading(true);
    setError("");
    try {
      const params = { page, limit };
      if (sortKey) {
        params.sort = sortDir === "desc" ? `-${sortKey}` : String(sortKey);
      }
      const res = await listLlmCosts(params);
      const arr = res?.items ?? (Array.isArray(res) ? res : []);
      setAllItems(arr);
      setItems(arr);
      setMeta({
        page: res?.meta?.page || page,
        limit: res?.meta?.limit || limit,
        total: res?.meta?.total ?? arr.length,
      });
    } catch (e) {
      setAllItems([]);
      setItems([]);
      setError(e?.response?.data?.message || e?.message || "Failed to load LLM costs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // initial load on mount
    load();
    // load is stable (declared in component scope) but depends on meta.limit if changed externally
    // We intentionally do not include 'load' in deps to avoid ref churn and infinite loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const columns = useMemo(() => {
    // buildColumnsFromSample is a pure function defined in this file; items is the only reactive input
    const base = buildColumnsFromSample(items || []);
    return base.slice();
  }, [items]);

  return (
    <div>
      {/* Table section */}
      <Card
        title="Costs"
        subtitle="LLM usage cost records — compact view with expandable details"
        className="mt-4"
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
          fetchPage={async (page, limit, sortKey, sortDir) => {
            await load(page, limit, sortKey, sortDir);
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
        width="min(96vw, 880px)"
        /* Costs-context variant to ensure subtle canvas tint on white surface */
        className="modal--costs"
        footer={
          <button className="btn btn-ghost" onClick={closeInspector} aria-label="Close details">Close</button>
        }
      >
        <CostsTreeInspector
          payload={inspectPayload}
        />
      </Modal>
    </div>
  );
}

// Inline helper component for the Costs inspector modal body with TreeView actions
function CostsTreeInspector({ payload }) {
  const [search, setSearch] = React.useState("");
  const treeRef = React.useRef(null);

  // Progressive expansion controller hook
  // eslint-disable-next-line import/no-useless-path-segments
  // PUBLIC_INTERFACE
  // useProgressiveExpand is a React hook that wraps a progressive controller to batch-expand tree nodes without blocking the UI.
  const { default: useProgressiveExpand } = require("../../hooks/useProgressiveExpand");
  const { running, progress, counts, startFromItems, cancel } = useProgressiveExpand({
    // Apply one batch by passing it to TreeView's batch expander
    applyBatch: (batch) => treeRef.current?.applyExpandBatch?.(batch),
    // Slightly larger slices for big payloads; default inside hook is adaptive too
    timeSliceMs: 8,
    onDone: () => {
      // no-op; UI state handled by hook
    },
    onCancel: () => {
      // no-op
    },
  });

  const onSearchChange = (e) => setSearch(e.target.value);

  const expandAll = React.useCallback(() => {
    const all = treeRef.current?.getAllExpandablePaths?.() || [];
    // Fast path for small datasets to preserve minimal overhead and UX
    if (all.length <= 300) {
      treeRef.current?.expandAll?.();
      return;
    }
    // Progressive expansion for large datasets
    startFromItems(all);
  }, [startFromItems]);

  const collapseAll = React.useCallback(() => {
    // Cancel any in-flight expansion to avoid racing updates
    if (running) cancel();
    treeRef.current?.collapseAll?.();
  }, [running, cancel]);

  // Auto-cancel if unmounted while expansion is running
  React.useEffect(() => {
    return () => {
      try {
        if (running) cancel();
      } catch {}
    };
  }, [running, cancel]);

  if (!payload) {
    return <div style={{ padding: "1rem" }}>No item selected</div>;
  }

  return (
    <div style={{ padding: "0" }}>
      <div className="sticky-header" style={{
        top: 0,
        zIndex: 1,
        // GxP: Accessibility/contrast fix for Costs View Details modal (REQ-UI-COSTS-MODAL-BG)
        // Use application canvas background inside the costs inspector header to avoid light-on-light contrast.
        background: "var(--bg-canvas, var(--ocean-bg, #f9fafb))",
        borderBottom: "1px solid var(--border-subtle)",
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}>
        <input
          className="input-search"
          placeholder="Search keys and values..."
          aria-label="Search in details"
          value={search}
          onChange={onSearchChange}
          style={{ flex: "1 1 260px", minWidth: 200 }}
        />
        <div style={{ flex: 1 }} />

        {/* Progress indicator */}
        {running ? (
          <div aria-live="polite" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <div title={`Expanding... ${progress}%`} style={{
              width: 120,
              height: 8,
              borderRadius: 999,
              background: "#E5E7EB",
              overflow: "hidden",
              border: "1px solid #E5E7EB"
            }}>
              <div style={{
                width: `${Math.max(4, progress)}%`,
                height: "100%",
                background: "#2563EB",
                transition: "width 120ms linear",
              }} />
            </div>
            <span style={{ fontSize: 12, color: "#0F172A" }}>
              {counts.processed}/{counts.total}
            </span>
          </div>
        ) : null}

        <button
          className="btn btn-secondary"
          onClick={expandAll}
          title="Expand all"
          disabled={running}
        >
          {running ? "Expanding..." : "Expand all"}
        </button>

        {running ? (
          <button className="btn btn-secondary" onClick={cancel} title="Stop expanding">
            Stop
          </button>
        ) : null}

        <button className="btn btn-secondary" onClick={collapseAll} title="Collapse all">Collapse all</button>
      </div>

      <div style={{
        padding: "12px 16px",
        maxHeight: "60vh",
        overflow: "auto",
        // GxP: Accessibility/contrast fix for Costs View Details modal (REQ-UI-COSTS-MODAL-BG)
        // Enforce application canvas background in modal content area.
        background: "var(--bg-canvas, var(--ocean-bg, #f9fafb))",
      }}>
        <TreeView
          ref={treeRef}
          data={payload}
          defaultExpandedDepth={1}
          searchTerm={search}
        />
      </div>
    </div>
  );
}
