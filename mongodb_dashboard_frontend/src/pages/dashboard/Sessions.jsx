import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import Modal from "../../components/ui/Modal.jsx";
import DataTable from "../../components/DataTable.jsx";
import { createSession, deleteSession, listSessions, updateSession } from "../../api/client";

// PUBLIC_INTERFACE
export default function Sessions() {
  /** Session tracking collection manager with table and CRUD modals. */
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const [editItem, setEditItem] = useState(null);
  const [openForm, setOpenForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  // Columns cover key schema fields, with common date formatting
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
        render: (v) => (v ? new Date(v).toLocaleString() : "")
      },
      {
        key: "session_end",
        label: "Ended",
        render: (v) => (v ? new Date(v).toLocaleString() : "")
      },
      { key: "status", label: "Status" },
      { key: "total_cost", label: "Total Cost" },
      {
        key: "created_at",
        label: "Created",
        render: (v) => (v ? new Date(v).toLocaleString() : "")
      },
    ],
    []
  );

  async function load() {
    setLoading(true);
    try {
      const data = await listSessions();
      const arr = Array.isArray(data) ? data : data?.items || [];
      setItems(arr);
    } catch {
      // Mock-friendly default for preview
      setItems([
        {
          _id: "sess1",
          task_id: "T-100",
          tenant_id: "TEN-1",
          organization_name: "Acme Corp",
          user_id: "U-1",
          user_name: "Ada",
          project_id: "P-9",
          container_id: "C-2",
          service_type: "code generation",
          session_start: new Date(Date.now() - 3600000).toISOString(),
          session_end: "",
          status: "active",
          total_cost: 1.75,
          created_at: new Date().toISOString()
        }
      ]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function newItem() {
    setEditItem({
      task_id: "",
      tenant_id: "",
      organization_name: "",
      user_id: "",
      user_name: "",
      project_id: "",
      container_id: "",
      service_type: "code generation",
      session_start: "",
      session_end: "",
      status: "active",
      total_cost: 0,
      created_at: ""
    });
    setOpenForm(true);
  }

  function onEdit(row) {
    setEditItem({ ...row });
    setOpenForm(true);
  }

  function onDelete(row) {
    setConfirmDelete(row);
  }

  async function submitForm() {
    const body = {
      ...editItem,
      total_cost: Number(editItem?.total_cost || 0),
    };
    if (editItem?._id) {
      await updateSession(editItem._id, body);
    } else {
      await createSession(body);
    }
    setOpenForm(false);
    setEditItem(null);
    await load();
  }

  async function confirmDeleteAction() {
    if (confirmDelete?._id) {
      await deleteSession(confirmDelete._id);
      setConfirmDelete(null);
      await load();
    }
  }

  return (
    <div>
      <Card
        title="Session Tracking"
        subtitle="Manage sessions across tenants and projects"
        actions={<Button onClick={newItem}>New Session</Button>}
      >
        <DataTable
          columns={columns}
          data={items}
          loading={loading}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </Card>

      <Modal
        title={editItem?._id ? "Edit Session" : "New Session"}
        open={openForm}
        onClose={() => setOpenForm(false)}
        footer={
          <div className="modal-actions">
            <Button variant="ghost" onClick={() => setOpenForm(false)}>Cancel</Button>
            <Button onClick={submitForm}>Save</Button>
          </div>
        }
      >
        {editItem && (
          <div className="form-grid">
            <label><span>Task ID</span><input value={editItem.task_id || ""} onChange={(e)=>setEditItem({...editItem, task_id: e.target.value})}/></label>
            <label><span>Tenant ID</span><input value={editItem.tenant_id || ""} onChange={(e)=>setEditItem({...editItem, tenant_id: e.target.value})}/></label>
            <label><span>Organization</span><input value={editItem.organization_name || ""} onChange={(e)=>setEditItem({...editItem, organization_name: e.target.value})}/></label>
            <label><span>User Name</span><input value={editItem.user_name || ""} onChange={(e)=>setEditItem({...editItem, user_name: e.target.value})}/></label>
            <label><span>Service Type</span>
              <select value={editItem.service_type || "code generation"} onChange={(e)=>setEditItem({...editItem, service_type: e.target.value})}>
                <option>code generation</option>
                <option>code query</option>
                <option>deep query</option>
                <option>interactive configuration</option>
                <option>auto configuration</option>
                <option>code maintenance</option>
              </select>
            </label>
            <label><span>Status</span>
              <select value={editItem.status || "active"} onChange={(e)=>setEditItem({...editItem, status: e.target.value})}>
                <option>active</option>
                <option>completed</option>
                <option>failed</option>
              </select>
            </label>
            <label><span>Session Start</span><input type="datetime-local" value={editItem.session_start || ""} onChange={(e)=>setEditItem({...editItem, session_start: e.target.value})}/></label>
            <label><span>Session End</span><input type="datetime-local" value={editItem.session_end || ""} onChange={(e)=>setEditItem({...editItem, session_end: e.target.value})}/></label>
            <label><span>Total Cost</span><input type="number" value={editItem.total_cost || 0} onChange={(e)=>setEditItem({...editItem, total_cost: e.target.value})}/></label>
            <label><span>Created At</span><input type="datetime-local" value={editItem.created_at || ""} onChange={(e)=>setEditItem({...editItem, created_at: e.target.value})}/></label>
          </div>
        )}
      </Modal>

      <Modal
        title="Delete session"
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        footer={
          <div className="modal-actions">
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDeleteAction}>Delete</Button>
          </div>
        }
      >
        <p>Are you sure you want to delete this session?</p>
      </Modal>
    </div>
  );
}
