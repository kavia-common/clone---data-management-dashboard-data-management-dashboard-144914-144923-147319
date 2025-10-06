import React, { useMemo, useState, useCallback } from "react";
import { formatCurrencyAmount } from "../../utils/formatCurrency";

/**
 * PUBLIC_INTERFACE
 * DetailsViewer
 * A reusable component to display an object's details in a user-friendly structured way.
 *
 * Features:
 * - Pretty renders top-level keys as a clean key/value list
 * - Nested objects/arrays are collapsible with proper a11y (aria-expanded, keyboard navigable)
 * - Known fields (timestamps, tokens, currency, cost, duration) are formatted
 * - Unknown keys are handled gracefully
 * - Raw JSON toggle with copy-to-clipboard
 *
 * Props:
 * - data: object|array|string (required) - Data to render
 * - title: string (optional) - Heading for the details viewer
 * - highlightKeys: string[] (optional) - Keys to show first
 * - collapsedDepth: number (optional, default 1) - Nesting depth at which to collapse children by default
 */
export default function DetailsViewer({
  data,
  title = "Details",
  highlightKeys = [],
  collapsedDepth = 1,
}) {
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const [openMap, setOpenMap] = useState(() => new Map()); // path => boolean

  const currencyHint = useMemo(() => {
    // Try to detect a currency from data if available.
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return (
        data.currency ||
        data.credits_unit ||
        data.cost_currency ||
        data.unit ||
        "USD"
      );
    }
    return "USD";
  }, [data]);

  const togglePath = useCallback((path, next) => {
    setOpenMap((prev) => {
      const m = new Map(prev);
      m.set(path, typeof next === "boolean" ? next : !(m.get(path) ?? false));
      return m;
    });
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(safePretty(data));
      setCopied(true);
      setTimeout(() => setCopied(false), 1300);
    } catch {
      // no-op
    }
  }, [data]);

  // PUBLIC_INTERFACE
  function safePretty(payload) {
    /** Returns JSON.stringify with fallback. */
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

  function toLabel(key) {
    if (!key && key !== 0) return "";
    if (key === "_id") return "ID";
    return String(key)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function isTimestampLike(key) {
    return /(timestamp|created_at|updated_at|createdAt|updatedAt|date)$/i.test(key || "");
  }

  function isTokenLike(key) {
    return /(token|tokens|total_tokens|prompt_tokens|completion_tokens)/i.test(key || "");
  }

  function isDurationLike(key) {
    return /(duration|elapsed|latency|time_ms|time_s)$/i.test(key || "");
  }

  function formatDuration(value, key) {
    // Accept seconds or milliseconds per key hints; default assume seconds.
    let seconds = Number(value);
    if (!Number.isFinite(seconds)) return String(value);
    if (/(_ms|ms)$/i.test(key || "")) {
      seconds = seconds / 1000;
    }
    if (seconds < 1) {
      return `${(seconds * 1000).toFixed(0)} ms`;
    }
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(" ");
  }

  function formatValueByKey(key, value, rootData) {
    if (value == null) return "—";

    // Primitive formatting
    if (typeof value === "number") {
      if (isTokenLike(key)) {
        return value.toLocaleString();
      }
      if (/^(total_cost|cost|organization_cost|price)$/i.test(key)) {
        const cur =
          (rootData && (rootData.currency || rootData.credits_unit || rootData.cost_currency)) ||
          currencyHint ||
          "USD";
        try {
          return formatCurrencyAmount(value, { currency: cur });
        } catch {
          return formatCurrencyAmount(value, { currency: "USD" });
        }
      }
      if (isDurationLike(key)) {
        return formatDuration(value, key);
      }
      // Generic number formatting
      return new Intl.NumberFormat().format(value);
    }

    if (typeof value === "string") {
      if (isTimestampLike(key)) {
        try {
          const d = new Date(value);
          const txt = d.toLocaleString();
          return txt;
        } catch {
          return value;
        }
      }
      if (/^currency$/i.test(key)) {
        return value.toUpperCase();
      }
      return value;
    }

    // Non-primitive is handled by renderer
    return value;
  }

  function initialCollapsed(depth) {
    return depth >= Math.max(0, collapsedDepth);
  }

  function Collapser({ id, label, summary, depth, children }) {
    const path = id;
    const isOpen = openMap.get(path) ?? !initialCollapsed(depth);
    const onToggle = () => togglePath(path);
    const onKey = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onToggle();
      }
    };

    return (
      <div className="dv-collapser">
        <button
          className="btn btn-ghost dv-toggle"
          aria-expanded={isOpen}
          aria-controls={`section-${path}`}
          onClick={onToggle}
          onKeyDown={onKey}
          title={isOpen ? "Collapse" : "Expand"}
        >
          <span className="dv-chevron" aria-hidden="true">
            {isOpen ? "▾" : "▸"}
          </span>
          <span className="dv-toggle-label">{label}</span>
          {summary ? <span className="dv-summary muted"> — {summary}</span> : null}
        </button>
        {isOpen ? (
          <div id={`section-${path}`} className="dv-section">
            {children}
          </div>
        ) : null}
      </div>
    );
  }

  function renderPrimitiveVal(key, value, root, emphasize = false) {
    const v = formatValueByKey(key, value, root);
    const isNumber = typeof value === "number";
    const cls = [
      "dv-val",
      isNumber ? "num" : "",
      emphasize ? "em" : "",
      /^(total_cost|cost)$/i.test(key || "") ? "pos" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return <span className={cls} title={String(v)}>{String(v)}</span>;
  }

  function renderNode(value, path, depth, rootObj) {
    if (value == null || typeof value !== "object") {
      // Primitive
      const key = path.split(".").pop();
      return <div className="dv-primitive">{renderPrimitiveVal(key, value, rootObj)}</div>;
    }

    if (Array.isArray(value)) {
      const label = `${toLabel(path.split(".").pop() || "Items")}`;
      const summary = `${value.length} item${value.length === 1 ? "" : "s"}`;
      return (
        <Collapser id={path} label={label} summary={summary} depth={depth}>
          <div className="dv-array">
            {value.length === 0 && <div className="dv-empty muted">Empty</div>}
            {value.map((item, idx) => (
              <div key={`${path}.${idx}`} className="dv-array-item">
                <div className="dv-array-index">#{idx + 1}</div>
                <div className="dv-array-body">
                  {typeof item === "object" && item !== null ? (
                    renderEntries(item, `${path}.${idx}`, depth + 1, rootObj)
                  ) : (
                    renderPrimitiveVal(String(idx), item, rootObj)
                  )}
                </div>
              </div>
            ))}
          </div>
        </Collapser>
      );
    }

    // Object
    const label = toLabel(path.split(".").pop() || "Object");
    const keys = Object.keys(value);
    const sampleSummary =
      keys.length > 0 ? `${keys.slice(0, 2).join(", ")}${keys.length > 2 ? ` +${keys.length - 2} more` : ""}` : "empty";
    return (
      <Collapser id={path} label={label} summary={sampleSummary} depth={depth}>
        {renderEntries(value, path, depth + 1, rootObj)}
      </Collapser>
    );
  }

  function renderEntries(obj, basePath = "root", depth = 0, rootObj = obj) {
    // Order: highlighted keys first (in the provided order), then remaining keys alphabetically.
    const keySet = new Set(Object.keys(obj || {}));
    const top = [];
    (highlightKeys || []).forEach((k) => {
      if (keySet.has(k)) {
        top.push(k);
        keySet.delete(k);
      }
    });
    const rest = Array.from(keySet).sort((a, b) => a.localeCompare(b));

    const ordered = [...top, ...rest];

    return (
      <dl className="dv-grid" aria-label="Details list">
        {ordered.map((k) => {
          const v = obj[k];
          const entryPath = `${basePath}.${k}`;
          const isObject = v && typeof v === "object";
          const emphasize =
            /^(model|llm_model|total_cost|cost|currency|project|project_id|user|user_id|tenant|tenant_id)$/i.test(k);

          return (
            <div key={entryPath} className="dv-row">
              <dt className="dv-key" title={toLabel(k)}>
                {toLabel(k)}
              </dt>
              <dd className="dv-valcell">
                {isObject ? renderNode(v, entryPath, depth, rootObj) : renderPrimitiveVal(k, v, rootObj, emphasize)}
              </dd>
            </div>
          );
        })}
      </dl>
    );
  }

  return (
    <div className="details-viewer">
      <div className="sticky-header dv-header">
        <div className="dv-header-left">
          <h2 className="dv-title" id="details-viewer-title">
            {title}
          </h2>
          {/* Quick highlights when available */}
          {data && typeof data === "object" && !Array.isArray(data) ? (
            <div className="dv-highlights">
              {["timestamp", "llm_model", "model", "prompt_tokens", "completion_tokens", "total_tokens", "currency", "total_cost", "cost", "project", "project_id", "user", "user_id"]
                .filter((k) => Object.prototype.hasOwnProperty.call(data, k))
                .slice(0, 4)
                .map((k) => (
                  <span key={k} className="dv-chip" title={`${toLabel(k)}: ${String(formatValueByKey(k, data[k], data))}`}>
                    <span className="dv-chip-key">{toLabel(k)}:</span>{" "}
                    <span className="dv-chip-val">
                      {typeof data[k] === "object"
                        ? "…"
                        : String(formatValueByKey(k, data[k], data))}
                    </span>
                  </span>
                ))}
            </div>
          ) : null}
        </div>
        <div className="dv-actions">
          <button
            className="btn btn-secondary"
            onClick={() => setShowRaw((s) => !s)}
            aria-pressed={showRaw}
            title={showRaw ? "Show formatted view" : "Show raw JSON"}
          >
            {showRaw ? "Formatted view" : "Raw JSON"}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleCopy}
            aria-label="Copy raw JSON to clipboard"
            title="Copy raw JSON"
          >
            {copied ? "Copied" : "Copy JSON"}
          </button>
        </div>
      </div>

      {!showRaw ? (
        <div className="dv-body">
          {data == null ? (
            <div className="dv-empty muted">No data</div>
          ) : typeof data === "object" ? (
            Array.isArray(data) ? (
              renderNode(data, "root", 0, data)
            ) : (
              renderEntries(data, "root", 0, data)
            )
          ) : (
            <div className="dv-primitive">{String(data)}</div>
          )}
        </div>
      ) : (
        <pre className="dv-raw" aria-label="Raw JSON">{safePretty(data)}</pre>
      )}

      <style>{`
        .details-viewer {
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .dv-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 16px;
          border-bottom: 1px solid var(--border-subtle);
          background: var(--bg-surface);
        }
        .dv-header-left { display: grid; gap: 8px; }
        .dv-title {
          margin: 0;
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
        }
        .dv-actions { display: inline-flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .dv-highlights { display: inline-flex; gap: 8px; flex-wrap: wrap; }
        .dv-chip {
          background: var(--badge-bg);
          color: var(--badge-text);
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 12px;
          font-weight: 600;
          white-space: nowrap;
        }
        .dv-chip-key { color: var(--text-tertiary); font-weight: 700; margin-right: 4px; }
        .dv-chip-val { color: var(--text-primary); }

        .dv-body {
          padding: 12px 16px 20px 16px;
        }

        .dv-grid {
          display: grid;
          grid-template-columns: 240px 1fr;
          gap: 6px 16px;
          margin: 0;
        }
        @media (max-width: 640px) {
          .dv-grid { grid-template-columns: 1fr; }
          .dv-key { margin-top: 8px; }
        }
        .dv-row { display: contents; }
        .dv-key {
          color: var(--text-tertiary);
          font-weight: 600;
          font-size: 12px;
          align-self: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dv-valcell { 
          display: block; 
          min-width: 0; 
          overflow: hidden; 
        }
        .dv-val { 
          white-space: nowrap; 
          overflow: hidden; 
          text-overflow: ellipsis; 
          display: inline-block; 
          max-width: 100%;
        }
        .dv-val.num { text-align: right; font-variant-numeric: tabular-nums; }
        .dv-val.em { font-weight: 600; }
        .dv-val.pos { color: var(--success); }

        .dv-primitive { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        .dv-collapser { display: grid; gap: 8px; }
        .dv-toggle {
          height: 32px;
          padding: 0 8px;
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-weight: 600;
        }
        .dv-toggle:focus-visible { outline: 3px solid rgba(14, 165, 233, 0.45); outline-offset: 2px; }
        .dv-chevron { width: 14px; display: inline-block; text-align: center; }
        .dv-toggle-label { color: var(--text-primary); }
        .dv-summary { color: var(--text-tertiary); font-size: 12px; }

        .dv-section { 
          padding: 8px 0 0 0; 
          border-left: 2px solid var(--border-subtle);
          margin-left: 8px;
          padding-left: 12px;
        }

        .dv-array { display: grid; gap: 8px; }
        .dv-array-item { 
          display: grid; 
          grid-template-columns: 60px 1fr; 
          gap: 8px; 
          padding: 8px; 
          border: 1px solid var(--border-subtle); 
          border-radius: 8px;
          background: #fafcff;
        }
        .dv-array-index { 
          color: var(--text-tertiary); 
          font-weight: 700; 
          display: grid; 
          place-items: center; 
        }
        .dv-array-body { min-width: 0; }

        .dv-raw {
          margin: 0;
          padding: 16px;
          background: #0b1020;
          color: #e6edf3;
          border-radius: 0;
          font-size: 12px;
          line-height: 1.4;
          overflow: auto;
        }

        .dv-empty { padding: 8px 0; }
      `}</style>
    </div>
  );
}
