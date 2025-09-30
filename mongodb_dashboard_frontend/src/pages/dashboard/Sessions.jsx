import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import DataTable from "../../components/DataTable.jsx";
import { deleteSession, listSessions } from "../../api/client";

// PUBLIC_INTERFACE
export default function Sessions() {
  /** Session tracking viewer: list and delete only (no create/update). */
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [error, setError] = useState("");

  const columns = useMemo(
    () => [
      { key: "task_id", label: "Task ID" },
      { key: "tenant_id", label: "Tenant ID" },
      { key: "organization_name", label: "Organization" },
      { key: "user_name", label: "User Name" },
      { key: "service_type", label: "Service Type" },
      {
        key: "session_start",
        label: "Started",
        render: (v) => (v ? new Date(v).toLocaleString() : "—")
      },
      {
        key: "session_end",
        label: "Ended",
        render: (v) => (v ? new Date(v).toLocaleString() : "—")
      },
      { key: "status", label: "Status", render: (v) => (v ? <span className="status-badge">{v}</span> : "—") },
      { key: "total_cost", label: "Total Cost", render: (v) => (typeof v === "number" ? <span className="amount-positive">{v.toLocaleString()}</span> : "—") },
      {
        key: "created_at",
        label: "Created",
        render: (v) => (v ? new Date(v).toLocaleString() : "—")
      },
    ],
    []
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      // listSessions uses normalizeListResponse and returns { items, total, meta }
      const res = await listSessions();
      const arr = res?.items ?? (Array.isArray(res) ? res : []);
      setItems(arr);
    } catch (e) {
      setItems([]);
      setError(e?.response?.data?.message || e?.message || "Failed to load sessions.");
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
        await deleteSession(confirmDelete._id);
        setConfirmDelete(null);
        await load();
      } catch (e) {
        setError(e?.response?.data?.message || e?.message || "Failed to delete session.");
      }
    }
  }

  return (
    <div>
      <Card
        title="Session Tracking"
        subtitle="View and delete session records"
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
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Delete session">
          <div className="modal-card">
            <div className="modal-header">
              <h3>Delete session</h3>
              <Button variant="ghost" aria-label="Close" onClick={() => setConfirmDelete(null)}>✕</Button>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete this session?</p>
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
