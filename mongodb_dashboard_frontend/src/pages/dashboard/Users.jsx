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

  const columns = useMemo(
    () => [
      { key: "referral_code", label: "Referral Code" },
      { key: "referral_stats.total_referrals", label: "Total Referrals" },
      { key: "referral_stats.verified_referrals", label: "Verified" },
      { key: "referral_stats.last_referral_date", label: "Last Referral" },
    ],
    []
  );

  async function load() {
    setLoading(true);
    try {
      const data = await listUsers();
      const arr = Array.isArray(data) ? data : data?.items || [];
      setItems(arr);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function newItem() {
    setEditItem({ referral_code: "", referral_stats: { total_referrals: 0, verified_referrals: 0, last_referral_date: "" } });
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
              <input type="number" value={editItem?.referral_stats?.total_referrals || 0} onChange={(e)=>setEditItem({
                ...editItem,
                referral_stats: { ...(editItem.referral_stats||{}), total_referrals: e.target.value }
              })}/>
            </label>
            <label>
              <span>Verified Referrals</span>
              <input type="number" value={editItem?.referral_stats?.verified_referrals || 0} onChange={(e)=>setEditItem({
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
