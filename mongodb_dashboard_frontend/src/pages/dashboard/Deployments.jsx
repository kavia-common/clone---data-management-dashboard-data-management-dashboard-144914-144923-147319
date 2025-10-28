import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import DataTable from "../../components/DataTable.jsx";
import { listDeployments } from "../../api";
import DeploymentsOverTime from "../../components/charts/DeploymentsOverTime.jsx";
import DeploymentStatusBarChart from "../../components/charts/DeploymentStatusBarChart.jsx";
import useDeploymentStatusCounts from "../../hooks/useDeploymentStatusCounts";

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
    { key: "project_display", label: "Project" },
    { key: "branch_name", label: "Branch Name" },
    { key: "status", label: "Status" },
    { key: "created_at", label: "Created At" },
    { key: "updated_at", label: "Updated At" },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });

  const allowedOrdered = useMemo(
    () => ["project_display", "branch_name", "status", "created_at", "updated_at"],
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
  function renderProject(v, row) {
    const projectName = row?.project_name || row?.projectName || "";
    const projectId = row?.project_id || row?.projectId || "";
    const primary = projectName || projectId || "—";

    // Include deployment_id as secondary detail via tooltip, not visible as primary label
    const deploymentId = row?.deployment_id || row?._id || "";
    const tooltip = deploymentId ? `Deployment ID: ${deploymentId}` : undefined;

    return (
      <span title={tooltip} style={{ display: "inline-block", whiteSpace: "normal", overflowWrap: "anywhere", fontWeight: 600 }}>
        {String(primary)}
      </span>
    );
  }

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
    return text === "—"
      ? "—"
      : (
        <span
          className="status-badge"
          title={text}
        >
          {text}
        </span>
      );
  }

  function buildColumns() {
    return [
      // Primary visible label: Project (project_name with fallback to project_id)
      {
        key: "project_display",
        label: "Project",
        render: (v, row) => renderProject(v, row),
        priority: 1,
      },
      { key: "branch_name", label: "Branch Name", render: (v) => (v == null || v === "" ? "—" : String(v)), priority: 2 },
      {
        key: "status",
        label: "Status",
        render: renderStatus,
        priority: 2,
        headerClassName: "col-status",
        cellClassName: "col-status",
      },
      {
        key: "created_at",
        label: "Created At",
        render: (v) => fmtDate(v),
        priority: 3,
        headerClassName: "col-created-at",
        cellClassName: "col-created-at",
      },
      {
        key: "updated_at",
        label: "Updated At",
        render: (v) => fmtDate(v),
        priority: 3,
        headerClassName: "col-updated-at",
        cellClassName: "col-updated-at",
      },
    ];
  }

  async function load(page = 1, limit = meta.limit || 10, sortKey, sortDir) {
    /**
     * Loads deployments with server-side sorting.
     * The backend supports a `sort` query parameter where:
     *  - asc: field
     *  - desc: -field
     * We map UI column keys to backend field names where necessary.
     */
    setLoading(true);
    setError("");
    try {
      const sortFieldMap = {
        project_display: "project_name", // derived UI field -> backend uses project_name
        branch_name: "branch_name",
        status: "status",
        created_at: "created_at",
        updated_at: "updated_at",
      };
      const params = { page, limit };
      if (sortKey) {
        const backendField = sortFieldMap[sortKey] || String(sortKey);
        params.sort = sortDir === "desc" ? `-${backendField}` : backendField;
      }

      const res = await listDeployments(params);
      const arr = res?.items ?? (Array.isArray(res) ? res : []);
      // Map items to inject a computed 'project_display' for display convenience.
      const mapped = (arr || []).map((it) => {
        const projectName = it?.project_name || it?.projectName || "";
        const projectId = it?.project_id || it?.projectId || "";
        return {
          ...it,
          project_display: projectName || projectId || "",
        };
      });
      setItems(mapped);
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

  // Hook to show status counts in a bar chart
  const { data: statusData, loading: statusLoading, error: statusError } = useDeploymentStatusCounts({
    // Client-side aggregate for now; can switch to useServer: true when endpoint exists.
    strategy: "clientAggregate",
    useServer: false,
    pageLimit: 200,
    maxPages: 3,
  });

  return (

    <div className="grid">
      {/* Chart block spans full width above the table */}
      <div className="block-full">
        <DeploymentsOverTime height={340} />
      </div>

      {/* New: Status counts bar chart */}
      <div className="block-full">
        <DeploymentStatusBarChart
          title="Deployments by Status"
          subtitle="All statuses"
          data={statusData}
          loading={statusLoading}
          error={statusError}
          height={300}
        />
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
            fetchPage={async (page, limit, sortKey, sortDir) => {
              await load(page, limit, sortKey, sortDir);
            }}
            autoWidth={false}
            paginationTitle="Deployment pages"
          />
        </Card>
      </div>
    </div>
  );
}
