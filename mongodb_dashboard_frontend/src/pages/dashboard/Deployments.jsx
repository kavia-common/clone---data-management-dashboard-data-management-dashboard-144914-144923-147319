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

  // Columns reflect key schema fields; render dates and URLs nicely
  const columns = useMemo(
    () => [
      { key: "deployment_id", label: "Deployment ID" },
      { key: "project_name", label: "Project" },
      { key: "branch_name", label: "Branch" },
      { key: "status", label: "Status" },
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
    try {
      const data = await listDeployments();
      const arr = Array.isArray(data) ? data : data?.items || [];
      setItems(arr);
    } catch {
      // Provide mock sample for preview when backend is unavailable
      setItems([
        {
          _id: "dep1",
          deployment_id: "D-2024-09-1001",
          project_id: "P-1",
          project_name: "Docs Service",
          branch_name: "main",
          status: "success",
          app_url: "https://docs.example.com",
          created_at: new Date(Date.now() - 7200000).toISOString(),
          updated_at: new Date().toISOString(),
          artifact_path: "/artifacts/build-1001",
          artifact_count: 3,
          custom_domain: "docs.example.com",
          domain_status: "verified",
          domain_checked_at: new Date().toISOString(),
          job_id: "JOB-1",
          task_id: "TASK-9",
          tenant_id: "TEN-1",
          tenant_name: "Acme",
          message: "Deployed successfully"
        }
      ]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function newItem() {
    setEditItem({
      deployment_id: "",
      app_id: "",
      app_url: "",
      artifact_path: "",
      branch_name: "",
      build_path: "",
      command: "",
      created_at: "",
      custom_domain: "",
      deployment_id_fmt: "",
      job_id: "",
      message: "",
      project_id: "",
      project_name: "",
      root_path: "",
      status: "in-progress",
      subdomain: "",
      task_id: "",
      tenant_id: "",
      tenant_name: "",
      updated_at: "",
      artifact_count: 0,
      domain_status: "",
      domain_checked_at: ""
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
      artifact_count: Number(editItem?.artifact_count || 0)
    };
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
            <label><span>Branch Name</span><input value={editItem.branch_name || ""} onChange={(e)=>setEditItem({...editItem, branch_name: e.target.value})}/></label>
            <label><span>Status</span>
              <select value={editItem.status || "in-progress"} onChange={(e)=>setEditItem({...editItem, status: e.target.value})}>
                <option>success</option>
                <option>failed</option>
                <option>in-progress</option>
              </select>
            </label>
            <label><span>App URL</span><input type="url" value={editItem.app_url || ""} onChange={(e)=>setEditItem({...editItem, app_url: e.target.value})}/></label>
            <label><span>Artifact Count</span><input type="number" value={editItem.artifact_count || 0} onChange={(e)=>setEditItem({...editItem, artifact_count: e.target.value})}/></label>
            <label><span>Domain Status</span><input value={editItem.domain_status || ""} onChange={(e)=>setEditItem({...editItem, domain_status: e.target.value})}/></label>
            <label><span>Created At</span><input type="datetime-local" value={editItem.created_at || ""} onChange={(e)=>setEditItem({...editItem, created_at: e.target.value})}/></label>
            <label><span>Updated At</span><input type="datetime-local" value={editItem.updated_at || ""} onChange={(e)=>setEditItem({...editItem, updated_at: e.target.value})}/></label>
            <label><span>Domain Checked At</span><input type="datetime-local" value={editItem.domain_checked_at || ""} onChange={(e)=>setEditItem({...editItem, domain_checked_at: e.target.value})}/></label>
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
