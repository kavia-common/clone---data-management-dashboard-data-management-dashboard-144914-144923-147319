import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import Modal from "../../components/ui/Modal.jsx";
import DataTable from "../../components/DataTable.jsx";
import { createUser, deleteUser, listUsers, updateUser } from "../../api/client";

// PUBLIC_INTERFACE
export default function Users() {
  /** Users (referral) collection manager with table and CRUD modals. */
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const [editItem, setEditItem] = useState(null);
  const [openForm, setOpenForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  // Columns map the provided schema: referral_code, referral_stats.*, created_at, updated_at
  const columns = useMemo(
    () => [
      { key: "referral_code", label: "Referral Code" },
      { key: "referral_stats.total_referrals", label: "Total Referrals" },
      { key: "referral_stats.verified_referrals", label: "Verified Referrals" },
      {
        key: "referral_stats.last_referral_date",
        label: "Last Referral",
        render: (v) => (v ? new Date(v).toLocaleString() : "")
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
    ],
    []
  );

  async function load() {
    setLoading(true);
    try {
      const data = await listUsers();
      // Allow both live API and mock usage
      const arr = Array.isArray(data) ? data : data?.items || [];
      setItems(arr);
    } catch {
      // Fallback to mock data for local preview if backend is not live
      setItems([
        {
          _id: "mock1",
          referral_code: "REF-ALPHA",
          referral_stats: { total_referrals: 12, verified_referrals: 7, last_referral_date: new Date().toISOString() },
          created_at: new Date(Date.now() - 86400000).toISOString(),
          updated_at: new Date().toISOString()
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function newItem() {
    setEditItem({
      referral_code: "",
      referral_stats: {
        total_referrals: 0,
        verified_referrals: 0,
        last_referral_date: ""
      },
      created_at: "",
      updated_at: ""
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
      referral_code: editItem.referral_code,
      referral_stats: {
        total_referrals: Number(editItem?.referral_stats?.total_referrals || 0),
        verified_referrals: Number(editItem?.referral_stats?.verified_referrals || 0),
        last_referral_date: editItem?.referral_stats?.last_referral_date || null,
      },
      created_at: editItem?.created_at || undefined,
      updated_at: editItem?.updated_at || undefined,
    };
    if (editItem?._id) {
      await updateUser(editItem._id, body);
    } else {
      await createUser(body);
    }
    setOpenForm(false);
    setEditItem(null);
    await load();
  }

  async function confirmDeleteAction() {
    if (confirmDelete?._id) {
      await deleteUser(confirmDelete._id);
      setConfirmDelete(null);
      await load();
    }
  }

  return (
    <div>
      <Card
        title="Users"
        subtitle="Referral users and statistics"
        actions={<Button onClick={newItem}>New User</Button>}
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
        title={editItem?._id ? "Edit User" : "New User"}
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
            <label>
              <span>Referral Code</span>
              <input value={editItem.referral_code || ""} onChange={(e)=>setEditItem({...editItem, referral_code: e.target.value})} />
            </label>
            <label>
              <span>Total Referrals</span>
              <input type="number" value={editItem?.referral_stats?.total_referrals ?? 0} onChange={(e)=>setEditItem({
                ...editItem,
                referral_stats: { ...(editItem.referral_stats||{}), total_referrals: e.target.value }
              })}/>
            </label>
            <label>
              <span>Verified Referrals</span>
              <input type="number" value={editItem?.referral_stats?.verified_referrals ?? 0} onChange={(e)=>setEditItem({
                ...editItem,
                referral_stats: { ...(editItem.referral_stats||{}), verified_referrals: e.target.value }
              })}/>
            </label>
            <label>
              <span>Last Referral Date</span>
              <input type="datetime-local" value={editItem?.referral_stats?.last_referral_date || ""} onChange={(e)=>setEditItem({
                ...editItem,
                referral_stats: { ...(editItem.referral_stats||{}), last_referral_date: e.target.value }
              })}/>
            </label>
            <label>
              <span>Created At</span>
              <input type="datetime-local" value={editItem?.created_at || ""} onChange={(e)=>setEditItem({ ...editItem, created_at: e.target.value })}/>
            </label>
            <label>
              <span>Updated At</span>
              <input type="datetime-local" value={editItem?.updated_at || ""} onChange={(e)=>setEditItem({ ...editItem, updated_at: e.target.value })}/>
            </label>
          </div>
        )}
      </Modal>

      <Modal
        title="Delete user"
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        footer={
          <div className="modal-actions">
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDeleteAction}>Delete</Button>
          </div>
        }
      >
        <p>Are you sure you want to delete this user?</p>
      </Modal>
    </div>
  );
}
