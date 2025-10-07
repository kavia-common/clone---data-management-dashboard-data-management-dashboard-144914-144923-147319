import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import DataTable from "../../components/DataTable.jsx";
import { listDeployments } from "../../api/client";
import DeploymentsOverTime from "../../components/charts/DeploymentsOverTime.jsx";

/**
 * PUBLIC_INTERFACE
 * Deployments page
 * Shows only the columns:
 * - Deployment Id (full value; no truncation and no copy control)
 * - Branch Name
 * - Status (badge)
 * - Created At
 * - Updated At
 * All other columns are removed.
 *
 * Note: Actions column has been removed. No edit/delete handlers are passed to DataTable.
 */
export default function Deployments() {
  /** App deployments viewer: read-only list; no actions column. */
  const [items, setItems] = useState([]);
  const [columns, setColumns] = useState([
    { key: "deployment_id", label: "Deployment Id" },
    { key: "branch_name", label: "Branch Name" },
    { key: "status", label: "Status" },
    { key: "created_at", label: "Created At" },
    { key: "updated_at", label: "Updated At" },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });

  const allowedOrdered = useMemo(
    () => ["deployment_id", "branch_name", "status", "created_at", "updated_at"],
    []
  );

  function fmtDate(val) {
    if (!val) return "—";
    try {
      return new Date(val).toLocaleString();
    } catch {
      return String(val);
    }
  }

  // Renderers per column
  function renderDeploymentId(v, row) {
    // Show full deployment ID with no truncation and no copy button.
    const full = v || row?.deployment_id || row?._id || "";
    if (!full) return "—";
    const title = String(full);

    // Allow wrapping and prevent overflow clipping
    return (
      <span title={title} style={{ display: "inline-block", whiteSpace: "normal", overflowWrap: "anywhere" }}>
        <code style={{ userSelect: "text", whiteSpace: "normal", overflowWrap: "anywhere" }}>{title}</code>
      </span>
    );
  }

  function renderStatus(v) {
    const text = v == null || v === "" ? "—" : String(v);
    return text === "—" ? "—" : <span className="status-badge">{text}</span>;
  }

  function buildColumns() {
    return [
      { key: "deployment_id", label: "Deployment Id", render: renderDeploymentId, priority: 1 },
      { key: "branch_name", label: "Branch Name", render: (v) => (v == null || v === "" ? "—" : String(v)), priority: 2 },
      { key: "status", label: "Status", render: renderStatus, priority: 2 },
      { key: "created_at", label: "Created At", render: (v) => fmtDate(v), priority: 3 },
      { key: "updated_at", label: "Updated At", render: (v) => fmtDate(v), priority: 3 },
    ];
  }

  async function load(page = 1, limit = meta.limit || 10) {
    setLoading(true);
    setError("");
    try {
      const res = await listDeployments({ page, limit });
      const arr = res?.items ?? (Array.isArray(res) ? res : []);
      setItems(arr);
      setMeta({
        page: res?.meta?.page || page,
        limit: res?.meta?.limit || limit,
        total: res?.meta?.total ?? arr.length,
      });
      setColumns(buildColumns());
    } catch (e) {
      setItems([]);
      setColumns(buildColumns());
      setError(e?.response?.data?.message || e?.message || "Failed to load deployments.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid">
      {/* Chart block spans full width above the table */}
      <div className="block-full">
        <DeploymentsOverTime height={340} />
      </div>

      {/* Keep the existing table in its own card; span full width */}
      <div className="block-full">
        <Card title="App Deployments" subtitle="Selected columns only">
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
            paginationTitle="Deployment pages"
          />
        </Card>
      </div>
    </div>
  );
}
