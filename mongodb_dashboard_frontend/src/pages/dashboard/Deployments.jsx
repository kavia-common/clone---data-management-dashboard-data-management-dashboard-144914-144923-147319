import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import DataTable from "../../components/DataTable.jsx";
import { deleteDeployment, listDeployments } from "../../api/client";
import { inferColumns } from "../../components/schemaUtils";

// PUBLIC_INTERFACE
export default function Deployments() {
  /** App deployments viewer: list and delete only (no create/update). */
  const [items, setItems] = useState([]);
  const [columns, setColumns] = useState([{ key: "_id", label: "ID" }]);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });

  const allowed = useMemo(
    () => [
      "_id",
      "deployment_id",
      "project_name",
      "branch_name",
      "status",
      "artifact_count",
      "domain_status",
      "app_url",
      "created_at",
      "updated_at",
      "domain_checked_at",
    ],
    []
  );

  async function load(page = 1, limit = meta.limit || 10) {
    setLoading(true);
    setError("");
    try {
      const res = await listDeployments({ page, limit });
      const arr = res?.items ?? (Array.isArray(res) ? res : []);
      setItems(arr);
      setMeta({ page: res?.meta?.page || page, limit: res?.meta?.limit || limit, total: res?.meta?.total ?? arr.length });
      const cols = inferColumns(arr, allowed, {
        dateFields: ["created_at", "updated_at", "domain_checked_at"],
      }).map((c) => {
        if (c.key === "status") {
          return { ...c, render: (v) => (v ? <span className="status-badge">{v}</span> : "—") };
        }
        if (c.key === "app_url") {
          return { ...c, render: (v) => (v ? <a href={v} target="_blank" rel="noreferrer">{v}</a> : "—") };
        }
        return c;
      });
      setColumns(cols);
    } catch (e) {
      setItems([]);
      setColumns([{ key: "_id", label: "ID" }]);
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
