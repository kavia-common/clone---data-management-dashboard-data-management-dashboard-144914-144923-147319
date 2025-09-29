import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import DataTable from "../../components/DataTable.jsx";
import { deleteUser, listUsers } from "../../api/client";

// PUBLIC_INTERFACE
export default function Users() {
  /** Users collection viewer: list and delete only (no create/update). */
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

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
      const arr = Array.isArray(data) ? data : data?.items || [];
      setItems(arr);
    } catch {
      setItems([]);
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
      >
        <DataTable
          columns={columns}
          data={items}
          loading={loading}
          onDelete={onDelete}
        />
      </Card>

      {confirmDelete && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Delete user">
          <div className="modal-card">
            <div className="modal-header">
              <h3>Delete user</h3>
              <Button variant="ghost" aria-label="Close" onClick={() => setConfirmDelete(null)}>✕</Button>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete this user?</p>
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
