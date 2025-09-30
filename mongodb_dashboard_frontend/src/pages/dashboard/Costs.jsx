import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import DataTable from "../../components/DataTable.jsx";
import { listLlmCosts } from "../../api/client";

/**
 * PUBLIC_INTERFACE
 * Costs page
 * Displays LLM usage cost records from /api/llm-costs in a responsive table with search/filter.
 * Mirrors the UX and styling of existing modules (Sessions/Deployments).
 */
export default function Costs() {
  const [allItems, setAllItems] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  // Table columns chosen to cover common fields for an llm_costs collection
  const columns = useMemo(
    () => [
      { key: "tenant_id", label: "Tenant ID" },
      { key: "organization_name", label: "Organization" },
      { key: "user_name", label: "User" },
      { key: "llm_provider", label: "Provider", priority: 4 },
      { key: "llm_model", label: "Model" },
      { key: "input_tokens", label: "In Tokens", priority: 5 },
      { key: "output_tokens", label: "Out Tokens", priority: 5 },
      {
        key: "total_tokens",
        label: "Total Tokens",
        render: (v, row) => {
          const total =
            typeof v === "number"
              ? v
              : (row?.input_tokens || 0) + (row?.output_tokens || 0);
          return typeof total === "number" ? total.toLocaleString() : "—";
        },
        priority: 4,
      },
      {
        key: "total_cost",
        label: "Total Cost",
        render: (v) =>
          typeof v === "number" ? (
            <span className="amount-positive">
              {v.toLocaleString(undefined, { style: "currency", currency: "USD" })}
            </span>
          ) : (
            "—"
          ),
      },
      {
        key: "timestamp",
        label: "Timestamp",
        render: (v, row) => {
          const t = v || row?.created_at || row?.createdAt || row?.updated_at || row?.updatedAt;
          return t ? new Date(t).toLocaleString() : "—";
        },
      },
      { key: "_id", label: "ID", render: (v, r) => v || r?.id || "—", priority: 6 },
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
    const filtered = (allItems || []).filter((c) => {
      const vals = [
        c?.tenant_id,
        c?.organization_name,
        c?.user_name,
        c?.llm_provider,
        c?.llm_model,
        c?._id,
        c?.id,
      ]
        .filter(Boolean)
        .map((v) => String(v).toLowerCase());
      return vals.some((v) => v.includes(q));
    });
    setItems(filtered);
  }, [query, allItems]);

  return (
    <div>
      <Card title="Costs" subtitle="LLM usage cost records">
        <div className="toolbar" aria-label="Costs toolbar">
          <input
            className="input-search"
            placeholder="Search costs (tenant, organization, model, user)..."
            aria-label="Search costs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="spacer" />
          {/* No Add button required */}
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <DataTable columns={columns} data={items} loading={loading} />
      </Card>
    </div>
  );
}
