import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import DataTable from "../../components/DataTable.jsx";
import { listLlmCosts } from "../../api/client";

/**
 * PUBLIC_INTERFACE
 * Costs page
 * Displays LLM usage cost records from /api/llm-costs in a responsive table with search/filter.
 * Mirrors the UX and styling of existing modules (Sessions/Deployments).
 *
 * Column strategy for Costs:
 * - Dynamically derive a column for every top-level field present in the fetched records (no hardcoded list).
 * - For arrays/objects, display a compact summary: arrays => "<n> items", objects => JSON string or key count.
 * - Apply friendly formatting for date-like fields and currency/number totals where applicable.
 */
export default function Costs() {
  const [allItems, setAllItems] = useState([]);
  const [items, setItems] = useState([]);
  const [columns, setColumns] = useState([{ key: "_id", label: "ID" }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

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
      new Set([
        "total_cost",
        "cost",
        "organization_cost",
      ]),
    []
  );
  const numericPrettyHints = useMemo(
    () => new Set(["total_tokens", "input_tokens", "output_tokens", "tokens", "count"]),
    []
  );

  // Build dynamic columns from data keys
  function deriveColumns(rows = []) {
    const keys = new Set();
    (rows || []).forEach((doc) => {
      Object.keys(doc || {}).forEach((k) => keys.add(k));
    });

    // Ensure _id is first if present, then others sorted alphabetically for predictability
    const orderedKeys = [
      ...(["_id"].filter((k) => keys.has(k))),
      ...Array.from(keys).filter((k) => k !== "_id").sort((a, b) => a.localeCompare(b)),
    ];

    const toLabel = (k) =>
      k === "_id"
        ? "ID"
        : k
            .replace(/_/g, " ")
            .replace(/\b\w/g, (m) => m.toUpperCase());

    const cols = orderedKeys.map((k) => {
      // Renderers for special field types
      const renderer = (value, row) => {
        const v = value ?? row?.[k];

        // Arrays: show count and preview first item primitive or key count if first item object
        if (Array.isArray(v)) {
          const count = v.length;
          if (count === 0) return "0 items";
          const first = v[0];
          if (first != null && typeof first === "object") {
            const keysPreview = Object.keys(first).length;
            return `${count} items`;
          }
          // Primitive preview
          const preview =
            typeof first === "string" || typeof first === "number" ? String(first) : "";
          return `${count} items${preview ? ` (e.g., ${preview})` : ""}`;
        }

        // Objects: compact JSON (top-level only)
        if (v && typeof v === "object") {
          try {
            // Prefer key count to avoid very long cells; allow quick glance
            const keyCount = Object.keys(v).length;
            if (keyCount > 4) return `${keyCount} keys`;
            return JSON.stringify(v);
          } catch {
            return "—";
          }
        }

        // Dates
        if (dateFieldHints.has(k)) {
          return v ? new Date(v).toLocaleString() : "—";
        }

        // Currency
        if (currencyFieldHints.has(k) && typeof v === "number") {
          return (
            <span className="amount-positive">
              {v.toLocaleString(undefined, { style: "currency", currency: "USD" })}
            </span>
          );
        }

        // Pretty numbers (tokens, counts)
        if (typeof v === "number" && (numericPrettyHints.has(k) || /token|count|total/i.test(k))) {
          return v.toLocaleString();
        }

        // Default
        return v === null || v === undefined || v === "" ? "—" : String(v);
      };

      return {
        key: k,
        label: toLabel(k),
        render: renderer,
      };
    });

    setColumns(cols.length ? cols : [{ key: "_id", label: "ID" }]);
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      // listLlmCosts normalizes response shape
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

  // Text search across all top-level fields (derived dynamically)
  useEffect(() => {
    const q = (query || "").trim().toLowerCase();
    if (!q) {
      setItems(allItems);
      return;
    }
    const filtered = (allItems || []).filter((doc) => {
      return Object.entries(doc || {}).some(([k, v]) => {
        // Convert arrays/objects to string summaries similarly to renderer logic for search
        let s = "";
        if (Array.isArray(v)) {
          s = `${v.length} items ${v[0] != null && typeof v[0] !== "object" ? String(v[0]) : ""}`;
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
      <Card title="Costs" subtitle="LLM usage cost records (all fields)">
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
