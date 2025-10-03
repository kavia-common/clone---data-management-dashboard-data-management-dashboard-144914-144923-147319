import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import DataTable from "../../components/DataTable.jsx";
import { listSessions } from "../../api/client";

// PUBLIC_INTERFACE
export default function Sessions() {
  /**
   * Session Tracking table restricted to show only the following columns (in this exact order):
   * - Task Id
   * - Tenant Id
   * - Organization Name
   * - User Name
   * - Service Type
   * - Total Cost
   *
   * All other columns (ID, session start/end, status, created/updated at, actions) are removed from both configuration and UI.
   */
  const [allItems, setAllItems] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });

  // Allowed and ordered fields per requirement
  const allowedOrdered = useMemo(
    () => [
      "task_id",
      "tenant_id",
      "organization_name",
      "user_name",
      "service_type",
      "total_cost",
    ],
    []
  );

  // PUBLIC_INTERFACE
  function toLabel(key) {
    /** Convert snake_case to Title Case label. */
    return String(key || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  // PUBLIC_INTERFACE
  function buildRestrictedColumns(rows = []) {
    /** Build DataTable columns strictly from the allowed list, preserving order, with appropriate renderers. */
    const presentKeys = new Set();
    (rows || []).forEach((r) => Object.keys(r || {}).forEach((k) => presentKeys.add(k)));

    return allowedOrdered.map((k) => {
      // total_cost: currency-like formatting if number
      if (k === "total_cost") {
        return {
          key: k,
          label: toLabel(k),
          render: (v) =>
            typeof v === "number" ? (
              <span className="amount-positive">
                {v.toLocaleString(undefined, { style: "currency", currency: "USD" })}
              </span>
            ) : v == null || v === "" ? "—" : String(v),
          priority: 2,
        };
      }
      // Regular text cells
      return {
        key: k,
        label: toLabel(k),
        render: (v) => (v == null || v === "" ? "—" : String(v)),
        priority: 2,
      };
    });
  }

  const [columns, setColumns] = useState(buildRestrictedColumns([]));

  async function load(page = 1, limit = meta.limit || 10) {
    setLoading(true);
    setError("");
    try {
      const res = await listSessions({ page, limit });
      const arr = res?.items ?? (Array.isArray(res) ? res : []);
      setAllItems(arr);
      setItems(arr);
      setMeta({
        page: res?.meta?.page || page,
        limit: res?.meta?.limit || limit,
        total: res?.meta?.total ?? arr.length,
      });
      setColumns(buildRestrictedColumns(arr));
    } catch (e) {
      setAllItems([]);
      setItems([]);
      setColumns(buildRestrictedColumns([]));
      setError(e?.response?.data?.message || e?.message || "Failed to load sessions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Client-side search limited to the visible fields only
  useEffect(() => {
    const q = (query || "").trim().toLowerCase();
    if (!q) {
      setItems(allItems);
      return;
    }
    const filtered = (allItems || []).filter((s) => {
      const vals = allowedOrdered
        .map((f) => s?.[f])
        .filter((v) => v !== undefined && v !== null)
        .map((v) => String(v).toLowerCase());
      return vals.some((v) => v.includes(q));
    });
    setItems(filtered);
  }, [query, allItems, allowedOrdered]);

  return (
    <div>
      <Card title="Session Tracking" subtitle="Selected columns only">
        <div className="toolbar" aria-label="Sessions toolbar">
          <input
            className="input-search"
            placeholder="Search by visible fields..."
            aria-label="Search sessions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="spacer" />
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <DataTable
          columns={columns}
          data={items}
          loading={loading}
          // No actions (edit/delete) per requirement to remove actions column from UI
          pageSize={meta.limit || 10}
          initialPage={meta.page || 1}
          serverTotal={meta.total}
          fetchPage={async (page, limit) => {
            await load(page, limit);
          }}
          paginationTitle="Sessions pages"
        />
      </Card>
    </div>
  );
}
