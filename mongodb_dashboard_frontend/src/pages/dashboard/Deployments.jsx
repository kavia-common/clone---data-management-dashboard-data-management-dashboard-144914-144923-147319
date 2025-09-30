import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import DataTable from "../../components/DataTable.jsx";
import { deleteDeployment, listDeployments } from "../../api/client";

// PUBLIC_INTERFACE
export default function Deployments() {
  /** App deployments viewer: list and delete only (no create/update). */
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [error, setError] = useState("");

  const columns = useMemo(
    () => [
      { key: "deployment_id", label: "Deployment ID" },
      { key: "project_name", label: "Project" },
      { key: "branch_name", label: "Branch" },
      { key: "status", label: "Status", render: (v) => v ? <span className="status-badge">{v}</span> : "—" },
      { key: "artifact_count", label: "Artifacts" },
      { key: "domain_status", label: "Domain Status" },
      {
        key: "app_url",
        label: "App URL",
        render: (v) => v ? <a href={v} target="_blank" rel="noreferrer">{v}</a> : ""
      },
      {
        key: "created_at",
        label: "Created",
        render: (v) => (v ? new Date(v).toLocaleString() : "")
      },
      {
        key: "updated_at",
        label: "Updated",
        render: (v) => (v ? new Date(v).toLocaleString() : "")
      },
      {
        key: "domain_checked_at",
        label: "Domain Checked",
        render: (v) => (v ? new Date(v).toLocaleString() : "")
      },
    ],
    []
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      // listDeployments uses normalizeListResponse and returns { items, total, meta }
      const res = await listDeployments();
      const arr = res?.items ?? (Array.isArray(res) ? res : []);
      setItems(arr);
    } catch (e) {
      setItems([]);
      setError(e?.response?.data?.message || e?.message || "Failed to load deployments.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

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
      <Card
        title="App Deployments"
        subtitle="View and delete application deployments"
      >
        {error && <div className="error" role="alert">{error}</div>}
        <DataTable
          columns={columns}
          data={items}
          loading={loading}
          onDelete={onDelete}
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
