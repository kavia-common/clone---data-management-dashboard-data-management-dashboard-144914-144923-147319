import React, { useEffect, useMemo, useState } from "react";
import Card from "./ui/Card.jsx";
import DataTable from "./DataTable.jsx";
import Button from "./ui/Button.jsx";
import { listUsers } from "../api/client";

/**
 * PUBLIC_INTERFACE
 * UsersList
 * A reusable users list component configured to show ONLY these columns:
 * - Name
 * - Organization
 * - Mail
 * - Department
 *
 * Notes:
 * - Organization column resolves in priority: organization_name -> organization -> organization_id.
 * - All other fields are hidden from the UI.
 * - Search covers these fields only to stay aligned with visible columns.
 */
export default function UsersList({ title = "Users", subtitle = "All users", showActions = false }) {
  const [allItems, setAllItems] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null); // kept for parity; actions disabled by default
  const [query, setQuery] = useState("");
  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });

  // Limit searchable fields to the visible columns (and their most likely underlying keys).
  const allowedFields = useMemo(
    () => [
      "name",
      "email",
      "department",
      "organization_name",
      "organization",
      "organization_id",
    ],
    []
  );

  // Fixed 4-column configuration, Ocean Professional compliant.
  const columns = useMemo(() => {
    const renderOrg = (v, row) =>
      row?.organization_name || row?.organization || row?.organization_id || "—";
    return [
      { key: "name", label: "Name", priority: 1 },
      { key: "__organization", label: "Organization", render: renderOrg, priority: 2 },
      { key: "email", label: "Mail", priority: 2 },
      { key: "department", label: "Department", priority: 3 },
    ];
  }, []);

  async function load(page = 1, limit = meta.limit || 10) {
    setLoading(true);
    setError("");
    try {
      const res = await listUsers({ page, limit });
      const arr = Array.isArray(res) ? res : res?.items || [];
      setAllItems(arr);
      setItems(arr);
      if (res && res.meta) {
        setMeta({
          page: res.meta.page || page,
          limit: res.meta.limit || limit,
          total: res.meta.total || arr.length,
        });
      } else {
        setMeta({ page: 1, limit, total: arr.length });
      }
    } catch (e) {
      setAllItems([]);
      setItems([]);
      setMeta({ page: 1, limit: 10, total: 0 });
      setError(e?.response?.data?.message || e?.message || "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Client-side filter across only the fields that correspond to visible columns.
  useEffect(() => {
    const q = (query || "").trim().toLowerCase();
    if (!q) {
      setItems(allItems);
      return;
    }
    const filtered = (allItems || []).filter((u) => {
      const vals = allowedFields
        .map((f) => u?.[f])
        .filter((v) => v !== undefined && v !== null)
        .map((v) => String(v).toLowerCase());
      return vals.some((v) => v.includes(q));
    });
    setItems(filtered);
  }, [query, allItems, allowedFields]);

  // Optional: delete action stub; no actions shown by default.
  function onDelete(row) {
    setConfirmDelete(row);
  }

  function closeDelete() {
    setConfirmDelete(null);
  }

  return (
    <div>
      <Card title={title} subtitle={subtitle}>
        <div className="toolbar" aria-label="Users toolbar">
          <input
            className="input-search"
            placeholder="Search users..."
            aria-label="Search users"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="spacer" />
          {/* No Add button */}
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
          pageSize={meta.limit || 10}
          initialPage={meta.page || 1}
          serverTotal={meta.total}
          fetchPage={async (page, limit) => {
            const q = (query || "").trim();
            // Keeping client search, refresh page from server.
            await load(page, limit);
          }}
          paginationTitle="Users pages"
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
