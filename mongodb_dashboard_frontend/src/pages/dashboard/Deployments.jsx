import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import DataTable from "../../components/DataTable.jsx";
import { deleteDeployment, listDeployments } from "../../api/client";

/**
 * PUBLIC_INTERFACE
 * Deployments page
 * Shows only the columns:
 * - Deployment Id (truncated to first 8 characters + ".." for display; full value on title + copy on click)
 * - Branch Name
 * - Status (badge)
 * - Created At
 * - Updated At
 * All other columns are removed.
 */
export default function Deployments() {
  /** App deployments viewer: list and delete only (no create/update). */
  const [items, setItems] = useState([]);
  const [columns, setColumns] = useState([
    { key: "deployment_id", label: "Deployment Id" },
    { key: "branch_name", label: "Branch Name" },
    { key: "status", label: "Status" },
    { key: "created_at", label: "Created At" },
    { key: "updated_at", label: "Updated At" },
  ]);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
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
    const full = v || row?.deployment_id || row?._id || "";
    if (!full) return "—";
    const truncated = String(full).length > 8 ? `${String(full).slice(0, 8)}..` : String(full);
    const title = String(full);
    const handleCopy = async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(String(full));
        // Optional: brief visual feedback (native title provides hover view)
      } catch {
        // ignore if clipboard not available
      }
    };
    return (
      <span title={title} style={{ whiteSpace: "nowrap" }}>
        <code style={{ userSelect: "text" }}>{truncated}</code>
        <button
          className="btn btn-ghost"
          onClick={handleCopy}
          aria-label="Copy Deployment Id"
          title="Copy full Deployment Id"
          style={{ padding: "2px 6px", height: 24, marginLeft: 6 }}
        >
          ⧉
        </button>
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
      // Keep only allowed fields in UI
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

  function onDelete(row) {
    setConfirmDelete(row);
  }

  async function confirmDeleteAction() {
    if (confirmDelete?._id) {
      try {
        await deleteDeployment(confirmDelete._id);
        setConfirmDelete(null);
        await load();
      } catch (e) {
        setError(e?.response?.data?.message || e?.message || "Failed to delete deployment.");
      }
    }
  }

  return (
    <div>
      <Card title="App Deployments" subtitle="Selected columns only">
        {error && <div className="error" role="alert">{error}</div>}
        <DataTable
          columns={columns}
          data={items}
          loading={loading}
          onDelete={onDelete}
          pageSize={meta.limit || 10}
          initialPage={meta.page || 1}
          serverTotal={meta.total}
          fetchPage={async (page, limit) => {
            await load(page, limit);
          }}
          paginationTitle="Deployment pages"
        />
      </Card>

      {confirmDelete && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Delete deployment">
          <div className="modal-card">
            <div className="modal-header">
              <h3>Delete deployment</h3>
              <Button variant="ghost" aria-label="Close" onClick={() => setConfirmDelete(null)}>✕</Button>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete this deployment?</p>
            </div>
            <div className="modal-footer">
              <div className="modal-actions">
                <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                <Button variant="danger" onClick={confirmDeleteAction}>Delete</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
