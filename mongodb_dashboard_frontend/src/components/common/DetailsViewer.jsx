import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { formatCurrencyAmount } from "../../utils/formatCurrency";
import { usdToCredits, formatCredits } from "../../utils/currency";
import { formatLabel } from "../../utils/formatLabel";

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
 * - onClose: function (optional) - When provided, displays a top-right Close (X) button that calls this handler
 * - autoFocusClose: boolean (optional, default false) - If true and onClose is provided, focuses the Close button on mount
 * - compactLeft: boolean (optional, default false) - When true, reduces left padding/margins and indentation for a tighter left alignment (used by Costs View Details modal)
 */
export default function DetailsViewer({
  data,
  title = "Details",
  highlightKeys = [],
  collapsedDepth = 1,
  onClose,
  autoFocusClose = false,
  compactLeft = false,
  // Optional: when provided, enables agent selection actions within arrays rendered under "...agents" keys.
  onAgentSelect,
}) {
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const [openMap, setOpenMap] = useState(() => new Map()); // path => boolean
  // Ref to support auto-focus on the close button for keyboard users
  const closeBtnRef = useRef(null);

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

  // When requested, move initial keyboard focus to the Close button for quick access
  useEffect(() => {
    if (autoFocusClose && onClose && closeBtnRef.current) {
      try {
        closeBtnRef.current.focus();
      } catch {
        // ignore focus errors
      }
    }
  }, [autoFocusClose, onClose]);

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

  // Use centralized label formatter to ensure consistency across app
  // This affects only visual labels, not the underlying data keys.

  function toLabel(key) {
    if (!key && key !== 0) return "";
    return formatLabel(key);
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

  // Normalize currency-like field names consistently
  const DV_CURRENCY_FIELDS = new Set(
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
      "user_cost",   // ensure user cost keys render as currency with credits
      "usercost",
    ].map((s) => s.toLowerCase())
  );
  function isCurrencyKeyLoose(k) {
    const key = String(k || "").toLowerCase();
    if (DV_CURRENCY_FIELDS.has(key)) return true;
    if (/_usd\b|\busd_|\busd$/i.test(key)) return true;
    return false;
  }

  function formatValueByKey(key, value, rootData) {
    if (value == null) return "—";

    // Attempt coercion for numeric-like strings
    const asNumber = typeof value === "number" ? value : Number(String(value).replace(/[$,]/g, ""));

    // Primitive formatting
    if (typeof value === "number" || Number.isFinite(asNumber)) {
      const n = typeof value === "number" ? value : asNumber;

      if (isTokenLike(key)) {
        return n.toLocaleString();
      }
      if (isCurrencyKeyLoose(key)) {
        const usdTxt = formatCurrencyAmount(n, { currency: "USD" });
        const creditsTxt = formatCredits(usdToCredits(n));
        return (
          <span title={`${usdTxt} • Credits Used: ${creditsTxt}`} style={{ whiteSpace: "nowrap" }}>
            {usdTxt}
            <span className="credits-inline muted"> • Credits Used: {creditsTxt}</span>
          </span>
        );
      }
      if (isDurationLike(key)) {
        return formatDuration(n, key);
      }
      // Generic number formatting
      return new Intl.NumberFormat().format(n);
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

  // Try to extract an agent identity from a value. Returns { id, name } or nulls.
  function extractAgentIdentity(item) {
    if (!item || typeof item !== "object") return { id: null, name: null };
    const id =
      item.id ??
      item._id ??
      item.agent_id ??
      item.agentId ??
      item.user_id ?? // legacy fallbacks if costs embed user-like docs
      item.userId ??
      item.metadata?.agent_id ??
      item.agent?.id ??
      null;
    const name =
      item.name ??
      item.agent_name ??
      item.agentName ??
      item.user_name ??
      item.username ??
      item.userName ??
      item.displayName ??
      item.metadata?.name ??
      item.agent?.name ??
      null;
    return { id: id ?? null, name: name ?? null };
  }

  function renderNode(value, path, depth, rootObj) {
    if (value == null || typeof value !== "object") {
      // Primitive
      const key = path.split(".").pop();
      return <div className="dv-primitive">{renderPrimitiveVal(key, value, rootObj)}</div>;
    }

    if (Array.isArray(value)) {
      const isTopLevel = path === "root";
      const keyName = path.split(".").pop();
      const label = `${toLabel(keyName || "Items")}`;
      const summary = `${value.length} item${value.length === 1 ? "" : "s"}`;

      // Detect "agents" arrays specifically for enhanced interaction
      const isAgentsArray = String(keyName || "").toLowerCase() === "agents";

      const body = (
        <div className="dv-array">
          {value.length === 0 && <div className="dv-empty muted">Empty</div>}
          {value.map((item, idx) => {
            const itemKey = `${path}.${idx}`;
            const isObj = typeof item === "object" && item !== null;

            const { id: candidateId, name: candidateName } = isObj ? extractAgentIdentity(item) : { id: null, name: null };

            return (
              <div key={itemKey} className="dv-array-item">
                <div className="dv-array-index">#{idx + 1}</div>
                <div className="dv-array-body">
                  {isObj ? (
                    renderEntries(item, itemKey, depth + 1, rootObj)
                  ) : (
                    renderPrimitiveVal(String(idx), item, rootObj)
                  )}
                  {isAgentsArray && typeof onAgentSelect === "function" && candidateId != null ? (
                    <div className="dv-array-actions">
                      <button
                        className="btn btn-secondary"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onAgentSelect({ agentId: candidateId, agentName: candidateName || undefined });
                        }}
                        title={`Open details for ${candidateName || candidateId || 'agent'}`}
                        aria-label={`Open details for ${candidateName || candidateId || 'agent'}`}
                        style={{ height: 28, padding: "0 8px", marginTop: 6 }}
                      >
                        Open details
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      );

      // For top-level arrays (path === "root"), or agents arrays, render plain list without a collapsible control.
      if (isTopLevel || isAgentsArray) {
        return body;
      }
      return (
        <Collapser id={path} label={label} summary={summary} depth={depth}>
          {body}
        </Collapser>
      );
    }

    // Object
    const isTopLevelObj = path === "root";
    const keyName = path.split(".").pop();
    const label = toLabel(keyName || "Object");

    // Special handling: if this object is under a key named "agents", treat it like a map of agents.
    if (String(keyName || "").toLowerCase() === "agents") {
      const entries = Object.entries(value || {});
      const body = (
        <div className="dv-array">
          {entries.length === 0 && <div className="dv-empty muted">Empty</div>}
          {entries.map(([k, v], idx) => {
            const itemKey = `${path}.${k}`;
            const isObj = v && typeof v === "object";
            const { id: candidateId, name: candidateName } = isObj ? extractAgentIdentity(v) : { id: null, name: null };
            return (
              <div key={itemKey} className="dv-array-item">
                <div className="dv-array-index">{toLabel(k)}</div>
                <div className="dv-array-body">
                  {isObj ? renderEntries(v, itemKey, depth + 1, rootObj) : renderPrimitiveVal(String(k), v, rootObj)}
                  {typeof onAgentSelect === "function" && candidateId != null ? (
                    <div className="dv-array-actions">
                      <button
                        className="btn btn-secondary"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onAgentSelect({ agentId: candidateId, agentName: candidateName || toLabel(k) });
                        }}
                        title={`Open details for ${candidateName || toLabel(k)}`}
                        aria-label={`Open details for ${candidateName || toLabel(k)}`}
                        style={{ height: 28, padding: "0 8px", marginTop: 6 }}
                      >
                        Open details
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      );

      // Agents object: wrap in a collapsible (unless top-level)
      if (isTopLevelObj) {
        return body;
      }
      return (
        <Collapser id={path} label={label} summary={`${entries.length} item${entries.length === 1 ? "" : "s"}`} depth={depth}>
          {body}
        </Collapser>
      );
    }

    const keys = Object.keys(value);
    const sampleSummary =
      keys.length > 0
        ? `${keys.slice(0, 2).map((k) => toLabel(k)).join(", ")}${keys.length > 2 ? ` +${keys.length - 2} more` : ""}`
        : "empty";
    const objBody = renderEntries(value, path, depth + 1, rootObj);
    if (isTopLevelObj) {
      // Render directly without a top-level "Root" collapsible.
      return objBody;
    }
    return (
      <Collapser id={path} label={label} summary={sampleSummary} depth={depth}>
        {objBody}
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
    <div className={`details-viewer ${compactLeft ? "dv-compact-left" : ""}`}>
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
          <button
            ref={closeBtnRef}
            className="btn btn-ghost"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            style={{
              height: 32,
              width: 32,
              display: "inline-grid",
              placeItems: "center",
              boxSizing: "border-box",
              padding: 0,
              lineHeight: 1,
              fontSize: 16,
              border: "1px solid var(--border-subtle)",
              borderRadius: 8,
            }}
            disabled={!onClose}
          >
            ×
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
          font-size: 18px;
          line-height: 1.35;
          font-weight: 800;
          color: var(--text-primary, #111827);
        }
        .dv-actions { display: inline-flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .dv-highlights { display: inline-flex; gap: 8px; flex-wrap: wrap; }
        .dv-chip {
          background: var(--badge-bg, #f3f4f6);
          color: var(--badge-text, var(--text-secondary));
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 12px;
          font-weight: 600;
          white-space: nowrap;
        }
        .dv-chip-key { color: var(--text-tertiary); font-weight: 700; margin-right: 4px; }
        .dv-chip-val { color: var(--text-primary, #111827); }

        .dv-body {
          padding: 14px 18px 22px 18px;
        }

        .dv-grid {
          display: grid;
          grid-template-columns: minmax(160px, 240px) 1fr; /* slightly wider label column for readability */
          gap: 0; /* we will handle padding within cells for better row backgrounds */
          margin: 0;
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          background: var(--bg-surface, #ffffff);
          box-shadow: 0 1px 2px rgba(16,24,40,0.04);
        }
        @media (max-width: 640px) {
          .dv-grid { grid-template-columns: 1fr; }
          /* On narrow screens, let labels wrap and align left for readability */
          .dv-key { margin-top: 0; text-align: left; white-space: normal; }
        }
        .dv-row { display: contents; }
        .dv-key,
        .dv-valcell {
          padding: 10px 12px;
          line-height: 1.55;
        }
        .dv-key {
          color: var(--text-tertiary, #6B7280);
          font-weight: 600;
          font-size: 12px;
          align-self: center;
          text-align: right; /* align labels close to their values on wider screens */
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          border-right: 1px solid var(--border-subtle);
        }
        @media (max-width: 640px) {
          .dv-key {
            border-right: none;
            border-bottom: 1px dashed var(--border-subtle);
          }
        }
        /* Zebra striping for improved scanability */
        .dv-grid .dv-row:nth-child(odd) .dv-key,
        .dv-grid .dv-row:nth-child(odd) .dv-valcell {
          background: #fcfcfd;
        }
        .dv-grid .dv-row + .dv-row .dv-key,
        .dv-grid .dv-row + .dv-row .dv-valcell {
          border-top: 1px solid var(--border-subtle);
        }
        .dv-valcell { 
          display: block; 
          min-width: 0; 
          overflow: hidden; 
          color: var(--text-primary, #111827);
        }
        .dv-val { 
          white-space: normal; 
          word-break: break-word;
          overflow-wrap: anywhere;
          overflow: visible; 
          text-overflow: clip; 
          display: inline-block; 
          max-width: 100%;
          min-width: 0;
        }
        .dv-val.num { text-align: right; font-variant-numeric: tabular-nums; }
        .dv-val.em { font-weight: 600; }
        .dv-val.pos { color: var(--success, #065f46); }

        .dv-primitive { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        .dv-collapser { display: grid; gap: 8px; }
        /* GxP Accessibility: Use surface token instead of hard white to avoid conflicts on canvas backgrounds */
        .dv-toggle {
          height: 32px;
          padding: 0 8px;
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-weight: 600;
          background: var(--bg-surface, #fff);
        }
        .dv-toggle:hover { 
          background: color-mix(in oklab, var(--color-accent, #F59E0B) 8%, transparent);
        }
        .dv-toggle:focus-visible { outline: 3px solid rgba(245, 158, 11, 0.55); outline-offset: 2px; }
        .dv-chevron { width: 14px; display: inline-block; text-align: center; }
        .dv-toggle-label { color: var(--text-primary, #111827); }
        .dv-summary { color: var(--text-tertiary); font-size: 12px; }

        .dv-section { 
          padding: 8px 0 0 0; 
          border-left: 2px solid var(--border-subtle);
          margin-left: 8px;
          padding-left: 12px;
          max-width: 100%;
          min-width: 0;
          overflow: hidden;
          box-sizing: border-box;
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
        .dv-array-actions { 
          margin-top: 8px; 
          display: flex; 
          gap: 8px; 
          align-items: center; 
        }
        .dv-array-actions .btn {
          font-size: 12px;
          font-weight: 600;
          white-space: nowrap;
          transition: all 0.2s ease;
        }
        .dv-array-actions .btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 2px 8px rgba(37, 99, 235, 0.15);
        }

        .dv-raw {
          margin: 0;
          padding: 16px;
          background: #0b1020;
          color: #e6edf3;
          border-radius: 0;
          font-size: 12px;
          line-height: 1.5;
          overflow: auto;
          max-width: 100%;
          box-sizing: border-box;
          word-break: break-all;
          white-space: pre-wrap;
        }

        .dv-empty { padding: 8px 0; }

        /* Compact-left variant for Costs View Details modal */
        .dv-compact-left .dv-header {
          padding-left: 10px; /* tighter than default 16px */
        }
        .dv-compact-left .dv-body {
          padding-left: 8px;  /* reduce left gutter to bring content closer to edge */
        }
        /* Reset default dl/dt/dd margins only within compact-left scope */
        .dv-compact-left dl,
        .dv-compact-left dt,
        .dv-compact-left dd {
          margin: 0;
        }
        .dv-compact-left dd.dv-valcell {
          margin: 0; /* ensure no extra left offset on value cell */
        }
        /* Slightly tighten column gap between label and value */
        .dv-compact-left .dv-grid {
          gap: 0;
        }
        /* Reduce left indentation for nested sections to avoid large left empty space */
        .dv-compact-left .dv-section {
          margin-left: 4px;
          padding-left: 8px;
          border-left-width: 1px;
        }
      `}</style>
    </div>
  );
}
