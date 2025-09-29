import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import Modal from "../../components/ui/Modal.jsx";
import DataTable from "../../components/DataTable.jsx";
import { createDeployment, deleteDeployment, listDeployments, updateDeployment } from "../../api/client";

// PUBLIC_INTERFACE
export default function Deployments() {
  /** App deployments collection manager with table and CRUD modals. */
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const [editItem, setEditItem] = useState(null);
  const [openForm, setOpenForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const columns = useMemo(
    () => [
      { key: "deployment_id", label: "Deployment ID" },
      { key: "project_name", label: "Project" },
      { key: "status", label: "Status" },
      { key: "app_url", label: "URL", render: (v) => v ? <a href={v} target="_blank" rel="noreferrer">{v}</a> : "" },
      { key: "created_at", label: "Created" },
      { key: "updated_at", label: "Updated" },
    ],
    []
  );

  async function load() {
    setLoading(true);
    try {
      const data = await listDeployments();
      const arr = Array.isArray(data) ? data : data?.items || [];
      setItems(arr);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function newItem() {
    setEditItem({
      deployment_id: "",
      project_id: "",
      project_name: "",
      status: "in-progress",
      app_url: "",
      created_at: "",
      updated_at: "",
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
    const body = { ...editItem };
    if (editItem?._id) {
      await updateDeployment(editItem._id, body);
    } else {
      await createDeployment(body);
    }
    setOpenForm(false);
    setEditItem(null);
    await load();
  }

  async function confirmDeleteAction() {
    if (confirmDelete?._id) {
      await deleteDeployment(confirmDelete._id);
      setConfirmDelete(null);
      await load();
    }
  }

  return (
    <div>
      <Card
        title="App Deployments"
        subtitle="Manage and audit application deployments"
        actions={<Button onClick={newItem}>New Deployment</Button>}
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
        title={editItem?._id ? "Edit Deployment" : "New Deployment"}
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
            <label><span>Deployment ID</span><input value={editItem.deployment_id || ""} onChange={(e)=>setEditItem({...editItem, deployment_id: e.target.value})}/></label>
            <label><span>Project ID</span><input value={editItem.project_id || ""} onChange={(e)=>setEditItem({...editItem, project_id: e.target.value})}/></label>
            <label><span>Project Name</span><input value={editItem.project_name || ""} onChange={(e)=>setEditItem({...editItem, project_name: e.target.value})}/></label>
            <label><span>Status</span>
              <select value={editItem.status || "in-progress"} onChange={(e)=>setEditItem({...editItem, status: e.target.value})}>
                <option>success</option>
                <option>failed</option>
                <option>in-progress</option>
              </select>
            </label>
            <label><span>App URL</span><input type="url" value={editItem.app_url || ""} onChange={(e)=>setEditItem({...editItem, app_url: e.target.value})}/></label>
            <label><span>Created At</span><input type="datetime-local" value={editItem.created_at || ""} onChange={(e)=>setEditItem({...editItem, created_at: e.target.value})}/></label>
            <label><span>Updated At</span><input type="datetime-local" value={editItem.updated_at || ""} onChange={(e)=>setEditItem({...editItem, updated_at: e.target.value})}/></label>
          </div>
        )}
      </Modal>

      <Modal
        title="Delete deployment"
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        footer={
          <div className="modal-actions">
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDeleteAction}>Delete</Button>
          </div>
        }
      >
        <p>Are you sure you want to delete this deployment?</p>
      </Modal>
    </div>
  );
}
