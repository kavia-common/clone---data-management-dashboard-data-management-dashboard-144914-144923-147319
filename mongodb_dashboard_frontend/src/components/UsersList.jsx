import React, { useEffect, useMemo, useState } from "react";
import Card from "./ui/Card.jsx";
import DataTable from "./DataTable.jsx";
import Button from "./ui/Button.jsx";
import { getApiClient, listUsers } from "../api/client";

/**
 * PUBLIC_INTERFACE
 * UsersList
 * A reusable users list component that:
 * - Fetches GET /api/users from the configured Axios client (REACT_APP_API_BASE_URL + REACT_APP_API_PREFIX)
 * - Handles both paginated envelope { success, data: [...], meta } and non-paginated array responses
 * - Displays records in a table styled per Ocean Professional theme
 * - Shows environment hints for API connectivity/debugging in development
 */
export default function UsersList({ title = "Users", subtitle = "All users", showActions = true }) {
  const [allItems, setAllItems] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [query, setQuery] = useState("");

  // Columns chosen to be resilient across variable schemas, matching Swagger GenericDocument flexibility.
  const columns = useMemo(
    () => [
      { key: "referral_code", label: "Referral Code" },
      { key: "name", label: "Name" },
      { key: "email", label: "Email" },
      {
        key: "created_at",
        label: "Created",
        render: (v, row) => (v || row?.createdAt ? new Date(v || row?.createdAt).toLocaleString() : "—"),
      },
      {
        key: "updated_at",
        label: "Updated",
        render: (v, row) => (v || row?.updatedAt ? new Date(v || row?.updatedAt).toLocaleString() : "—"),
      },
      // Always show some form of ID for clarity
      { key: "_id", label: "ID", render: (v, row) => v || row?.id || "—" },
    ],
    []
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      // listUsers uses normalization to accommodate array or envelope.
      const res = await listUsers();
      const arr = Array.isArray(res) ? res : res?.items || [];
      setAllItems(arr);
      setItems(arr);
    } catch (e) {
      setAllItems([]);
      setItems([]);
      setError(e?.response?.data?.message || e?.message || "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Client-side filter across common user fields and potential tenant-like identifiers in user object
  useEffect(() => {
    const q = (query || "").trim().toLowerCase();
    if (!q) {
      setItems(allItems);
      return;
    }
    const filtered = (allItems || []).filter((u) => {
      const vals = [
        u?.referral_code,
        u?.name,
        u?.email,
        u?._id,
        u?.id,
        u?.tenant_id,
        u?.tenant_name,
        u?.organization_name,
      ]
        .filter(Boolean)
        .map((v) => String(v).toLowerCase());
      return vals.some((v) => v.includes(q));
    });
    setItems(filtered);
  }, [query, allItems]);

  // Optional: delete action stub; actual delete handled by page-level component if passed.
  function onDelete(row) {
    setConfirmDelete(row);
  }

  function closeDelete() {
    setConfirmDelete(null);
  }

  // Dev-only: render a small environment helper block
  function EnvHint() {
    if (process.env.NODE_ENV === "production") return null;
    try {
      const api = getApiClient();
      const base = api?.defaults?.baseURL || "/api";
      const raw = process.env.REACT_APP_API_URL || process.env.REACT_APP_API_BASE_URL || "(same-origin)";
      const prefix = process.env.REACT_APP_API_PREFIX || "/api";
      return (
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          <span>API base: {base}</span> • <span>RAW: {raw}</span> • <span>PREFIX: {prefix}</span>
        </div>
      );
    } catch {
      return null;
    }
  }

  return (
    <div>
      <Card title={title} subtitle={subtitle}>
        <EnvHint />
        <div className="toolbar" aria-label="Users toolbar">
          <input
            className="input-search"
            placeholder="Search users or tenants..."
            aria-label="Search users or tenants"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="spacer" />
          {/* Removed Add User button as requested */}
        </div>
        {error && (
          <div className="error" role="alert" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}
        <DataTable
          columns={columns}
          data={items}
          loading={loading}
          onDelete={showActions ? onDelete : undefined}
        />
      </Card>

      {confirmDelete && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Delete user">
          <div className="modal-card">
            <div className="modal-header">
              <h3>Delete user</h3>
              <Button variant="ghost" aria-label="Close" onClick={closeDelete}>
                ✕
              </Button>
            </div>
            <div className="modal-body">
              <p>
                This is a preview-only delete dialog for the shared UsersList component.
                Implement actual deletion in the parent page if required.
              </p>
            </div>
            <div className="modal-footer">
              <div className="modal-actions">
                <Button variant="ghost" onClick={closeDelete}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
