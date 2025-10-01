import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import DataTable from "../../components/DataTable.jsx";
import { listLlmCosts } from "../../api/client";

/**
 * PUBLIC_INTERFACE
 * Costs page
 * Displays LLM usage cost records with full visibility of nested structures:
 * - Array-of-objects fields become expandable mini-tables within the cell.
 * - Object fields render key-value mini-tables inline.
 * - Primitive arrays show first N entries, with a "see more" to expand full list.
 */
export default function Costs() {
  const [allItems, setAllItems] = useState([]);
  const [items, setItems] = useState([]);
  const [columns, setColumns] = useState([{ key: "_id", label: "ID" }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  // local expanded state per row and field
  const [expandedCells, setExpandedCells] = useState({}); // { [rowId]: { [fieldKey]: true } }

  // Heuristics for special formatting
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
    () =>
      new Set(["total_cost", "cost", "organization_cost"]),
    []
  );
  const numericPrettyHints = useMemo(
    () => new Set(["total_tokens", "input_tokens", "output_tokens", "tokens", "count"]),
    []
  );

  function toLabel(k) {
    return k === "_id"
      ? "ID"
      : k.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function toggleExpand(rowId, key) {
    setExpandedCells((prev) => {
      const rowMap = prev[rowId] || {};
      return {
        ...prev,
        [rowId]: { ...rowMap, [key]: !rowMap[key] },
      };
    });
  }

  // Render a small key-value mini table for plain objects
  function renderObjectKV(obj) {
    if (!obj || typeof obj !== "object") return "—";
    const entries = Object.entries(obj);
    if (!entries.length) return "—";
    return (
      <div className="table-wrapper" style={{ border: "0", boxShadow: "none" }}>
        <div className="table-scroll sm" style={{ maxHeight: 180 }}>
          <table className="table" style={{ minWidth: 360 }}>
            <thead>
              <tr>
                <th className="th">Key</th>
                <th className="th">Value</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([k, v]) => (
                <tr className="tr" key={k}>
                  <td className="td">{k}</td>
                  <td className="td">
                    {v && typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Compute common keys across array-of-objects
  function getCommonKeys(arr) {
    const keySet = new Set();
    arr.forEach((it) => {
      if (it && typeof it === "object" && !Array.isArray(it)) {
        Object.keys(it).forEach((k) => keySet.add(k));
      }
    });
    return Array.from(keySet);
  }

  // Render array-of-objects as mini-table (expandable), or primitive array with preview
  function renderArrayField(rowId, fieldKey, arr, previewCount = 3) {
    if (!Array.isArray(arr)) return "—";
    if (arr.length === 0) return "0 items";

    const isObjArray = arr[0] && typeof arr[0] === "object" && !Array.isArray(arr[0]);

    const isExpanded = !!(expandedCells[rowId] && expandedCells[rowId][fieldKey]);

    if (!isObjArray) {
      // Primitive array: preview first N entries with "see more"
      const shown = isExpanded ? arr : arr.slice(0, previewCount);
      return (
        <div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {shown.map((v, idx) => (
              <span key={idx} className="status-badge" style={{ whiteSpace: "nowrap" }}>
                {String(v)}
              </span>
            ))}
          </div>
          {arr.length > previewCount && (
            <button
              className="btn btn-ghost"
              style={{ marginTop: 6, padding: "4px 8px", height: 28 }}
              onClick={() => toggleExpand(rowId, fieldKey)}
            >
              {isExpanded ? "See less" : `See ${arr.length - previewCount} more`}
            </button>
          )}
        </div>
      );
    }

    // Array of objects: mini-table with common keys, preview first N rows and expand
    const common = getCommonKeys(arr);
    const shownRows = isExpanded ? arr : arr.slice(0, previewCount);

    return (
      <div>
        <div className="table-wrapper" style={{ border: "0", boxShadow: "none" }}>
          <div className="table-scroll sm" style={{ maxHeight: 220 }}>
            <table className="table" style={{ minWidth: Math.min(960, 160 + common.length * 140) }}>
              <thead>
                <tr>
                  {common.map((k) => (
                    <th key={k} className="th">
                      {toLabel(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shownRows.map((obj, idx) => (
                  <tr className="tr" key={idx}>
                    {common.map((k) => {
                      const v = obj?.[k];
                      const isNum = typeof v === "number";
                      const isObj = v && typeof v === "object";
                      return (
                        <td key={k} className={`td ${isNum ? "num" : ""}`}>
                          {isObj ? JSON.stringify(v) : v ?? "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {arr.length > previewCount && (
          <button
            className="btn btn-ghost"
            style={{ marginTop: 6, padding: "4px 8px", height: 28 }}
            onClick={() => toggleExpand(rowId, fieldKey)}
          >
            {isExpanded ? "See less" : `See ${arr.length - previewCount} more`}
          </button>
        )}
      </div>
    );
  }

  // Build dynamic columns from data keys and attach rendering
  function deriveColumns(rows = []) {
    const keys = new Set();
    (rows || []).forEach((doc) => {
      Object.keys(doc || {}).forEach((k) => keys.add(k));
    });

    const orderedKeys = [
      ...(["_id"].filter((k) => keys.has(k))),
      ...Array.from(keys).filter((k) => k !== "_id").sort((a, b) => a.localeCompare(b)),
    ];

    const cols = orderedKeys.map((k) => {
      const renderer = (value, row) => {
        const v = value ?? row?.[k];
        const rowId = row?._id || row?.id || JSON.stringify(row).slice(0, 32);

        // Arrays
        if (Array.isArray(v)) {
          return renderArrayField(rowId, k, v, 3);
        }

        // Objects: render kv mini-table (useful for costs_by_date, tokens_by_date)
        if (v && typeof v === "object") {
          return renderObjectKV(v);
        }

        // Date-like
        if (dateFieldHints.has(k)) {
          return v ? new Date(v).toLocaleString() : "—";
        }

        // Currency-like
        if (currencyFieldHints.has(k) && typeof v === "number") {
          return (
            <span className="amount-positive">
              {v.toLocaleString(undefined, { style: "currency", currency: "USD" })}
            </span>
          );
        }

        // Large numbers (tokens)
        if (typeof v === "number" && (numericPrettyHints.has(k) || /token|count|total/i.test(k))) {
          return v.toLocaleString();
        }

        return v === null || v === undefined || v === "" ? "—" : String(v);
      };

      return { key: k, label: toLabel(k), render: renderer };
    });

    setColumns(cols.length ? cols : [{ key: "_id", label: "ID" }]);
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await listLlmCosts();
      const arr = res?.items ?? (Array.isArray(res) ? res : []);
      setAllItems(arr);
      setItems(arr);
      deriveColumns(arr);
    } catch (e) {
      setAllItems([]);
      setItems([]);
      setColumns([{ key: "_id", label: "ID" }]);
      setError(e?.response?.data?.message || e?.message || "Failed to load LLM costs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Text search across all top-level fields with deeper serialization for objects/arrays
  useEffect(() => {
    const q = (query || "").trim().toLowerCase();
    if (!q) {
      setItems(allItems);
      return;
    }
    const filtered = (allItems || []).filter((doc) => {
      return Object.entries(doc || {}).some(([k, v]) => {
        let s = "";
        if (Array.isArray(v)) {
          try {
            s = JSON.stringify(v);
          } catch {
            s = `${v.length} items`;
          }
        } else if (v && typeof v === "object") {
          try {
            s = JSON.stringify(v);
          } catch {
            s = "";
          }
        } else if (v !== null && v !== undefined) {
          s = String(v);
        }
        return s.toLowerCase().includes(q);
      });
    });
    setItems(filtered);
  }, [query, allItems]);

  return (
    <div>
      <Card title="Costs" subtitle="LLM usage cost records (expanded nested fields)">
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
        <DataTable columns={columns} data={items} loading={loading} pageSize={10} />
      </Card>
    </div>
  );
}
