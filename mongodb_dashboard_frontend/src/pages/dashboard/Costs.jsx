import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import DataTable from "../../components/DataTable.jsx";
import { listLlmCosts } from "../../api/client";
import { inferColumns } from "../../components/schemaUtils";

/**
 * PUBLIC_INTERFACE
 * Costs page
 * Displays LLM usage cost records from /api/llm-costs in a responsive table with search/filter.
 * Mirrors the UX and styling of existing modules (Sessions/Deployments).
 */
export default function Costs() {
  const [allItems, setAllItems] = useState([]);
  const [items, setItems] = useState([]);
  const [columns, setColumns] = useState([{ key: "_id", label: "ID" }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  // Allowed fields for llm-costs
  const allowed = useMemo(
    () => [
      "_id",
      "tenant_id",
      "organization_name",
      "user_name",
      "llm_provider",
      "llm_model",
      "input_tokens",
      "output_tokens",
      "total_tokens",
      "total_cost",
      "timestamp",
      "created_at",
      "updated_at",
    ],
    []
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      // listLlmCosts normalizes response shape
      const res = await listLlmCosts();
      const arr = res?.items ?? (Array.isArray(res) ? res : []);
      setAllItems(arr);
      setItems(arr);

      // infer existing columns, then add special renderers for totals and currency
      const cols = inferColumns(arr, allowed, { dateFields: ["timestamp", "created_at", "updated_at"] }).map((c) => {
        if (c.key === "total_tokens") {
          return {
            ...c,
            render: (v, row) => {
              const total = typeof v === "number" ? v : (row?.input_tokens || 0) + (row?.output_tokens || 0);
              return typeof total === "number" ? total.toLocaleString() : "—";
            },
            priority: 4,
          };
        }
        if (c.key === "total_cost") {
          return {
            ...c,
            render: (v) =>
              typeof v === "number" ? (
                <span className="amount-positive">
                  {v.toLocaleString(undefined, { style: "currency", currency: "USD" })}
                </span>
              ) : (
                "—"
              ),
          };
        }
        return c;
      });
      setColumns(cols);
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

  useEffect(() => {
    const q = (query || "").trim().toLowerCase();
    if (!q) {
      setItems(allItems);
      return;
    }
    const filtered = (allItems || []).filter((c) => {
      const vals = allowed
        .map((f) => c?.[f])
        .concat([c?.id])
        .filter((v) => v !== undefined && v !== null)
        .map((v) => String(v).toLowerCase());
      return vals.some((v) => v.includes(q));
    });
    setItems(filtered);
  }, [query, allItems, allowed]);

  return (
    <div>
      <Card title="Costs" subtitle="LLM usage cost records">
        <div className="toolbar" aria-label="Costs toolbar">
          <input
            className="input-search"
            placeholder="Search costs..."
            aria-label="Search costs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="spacer" />
          {/* No Add button required */}
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <DataTable columns={columns} data={items} loading={loading} pageSize={10} />
      </Card>
    </div>
  );
}
