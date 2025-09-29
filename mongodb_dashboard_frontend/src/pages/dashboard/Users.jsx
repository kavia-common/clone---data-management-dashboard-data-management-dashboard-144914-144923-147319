import React, { useEffect, useMemo, useState } from "react";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import DataTable from "../../components/DataTable.jsx";
import { deleteUser, listUsers } from "../../api/client";

// Safely extract referral stats whether it's an object or an array
function getReferralStats(row) {
  // referral_stats may be:
  // - object: { total_referrals, verified_referrals, last_referral_date, ... }
  // - array:  [ { total_referrals, ... } ] or history list
  const rs = row?.referral_stats;
  if (!rs) return {};
  if (Array.isArray(rs)) {
    // If array contains an object with stats, prefer first non-null object with those keys
    const candidate =
      rs.find(
        (it) =>
          it &&
          (typeof it.total_referrals !== "undefined" ||
            typeof it.verified_referrals !== "undefined" ||
            typeof it.last_referral_date !== "undefined")
      ) || rs[0] || {};
    return candidate || {};
  }
  if (typeof rs === "object") return rs;
  return {};
}

// Null-safe date formatting
function fmtDate(v) {
  if (!v) return "—";
  try {
    const d = new Date(v);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

// Null-safe text
function fmtText(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return "—";
    }
  }
  return String(v);
}

// PUBLIC_INTERFACE
export default function Users() {
  /** Users collection viewer: robust list and delete (no create/update).
   * Handles flexible schema from backend. Renders hyphens if fields are missing.
   */
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const columns = useMemo(
    () => [
      {
        key: "referral_code",
        label: "Referral Code",
        render: (v) => fmtText(v),
      },
      {
        key: "referral_stats.total_referrals",
        label: "Total Referrals",
        render: (_v, row) => {
          const rs = getReferralStats(row);
          return fmtText(rs.total_referrals ?? rs.total ?? 0);
        },
      },
      {
        key: "referral_stats.verified_referrals",
        label: "Verified Referrals",
        render: (_v, row) => {
          const rs = getReferralStats(row);
          return fmtText(rs.verified_referrals ?? rs.verified ?? 0);
        },
      },
      {
        key: "referral_stats.last_referral_date",
        label: "Last Referral",
        render: (_v, row) => {
          const rs = getReferralStats(row);
          return fmtDate(rs.last_referral_date ?? rs.last_referral ?? row?.last_referral_date);
        },
      },
      {
        key: "referral_history",
        label: "Referral History",
        render: (v) => {
          // optional: show count if array, safe stringify otherwise
          if (!v) return "—";
          if (Array.isArray(v)) return `${v.length} item(s)`;
          if (typeof v === "object") {
            try {
              // Try to show a short summary
              const keys = Object.keys(v);
              return keys.length ? `obj:${keys.length} key(s)` : "—";
            } catch {
              return "—";
            }
          }
          return fmtText(v);
        },
      },
      {
        key: "created_at",
        label: "Created",
        render: (v, row) => fmtDate(v ?? row?.createdAt),
      },
      {
        key: "updated_at",
        label: "Updated",
        render: (v, row) => fmtDate(v ?? row?.updatedAt),
      },
      // Fallback: show _id so users can correlate entries
      {
        key: "_id",
        label: "ID",
        render: (v, row) => fmtText(v ?? row?.id),
      },
    ],
    []
  );

  async function load() {
    setLoading(true);
    try {
      const data = await listUsers();
      const arr = Array.isArray(data) ? data : data?.items || [];
      // Ensure each item has safe defaults to avoid render-time errors
      const safe = (arr || []).map((it) => ({
        _id: it?._id ?? it?.id ?? undefined,
        referral_code: it?.referral_code ?? it?.code ?? it?.referralCode ?? undefined,
        referral_stats: it?.referral_stats ?? it?.referralStats ?? it?.stats ?? undefined,
        referral_history: it?.referral_history ?? it?.referralHistory ?? undefined,
        created_at: it?.created_at ?? it?.createdAt ?? undefined,
        updated_at: it?.updated_at ?? it?.updatedAt ?? undefined,
        // keep rest of fields as-is
        ...it,
      }));
      setItems(safe);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

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
      <Card title="Users" subtitle="Referral users and statistics (null-safe, flexible schema)">
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
              <Button variant="ghost" aria-label="Close" onClick={() => setConfirmDelete(null)}>
                ✕
              </Button>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete this user?</p>
            </div>
            <div className="modal-footer">
              <div className="modal-actions">
                <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={confirmDeleteAction}>
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
