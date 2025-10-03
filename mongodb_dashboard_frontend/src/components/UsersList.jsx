import React, { useEffect, useMemo, useState } from "react";
import Card from "./ui/Card.jsx";
import DataTable from "./DataTable.jsx";
import Button from "./ui/Button.jsx";
import Tabs from "./ui/Tabs.jsx";
import { listUsers } from "../api/client";

/**
 * PUBLIC_INTERFACE
 * UsersList
 * A reusable users list component that:
 * - Fetches GET /api/users from the configured Axios client (REACT_APP_API_BASE_URL + REACT_APP_API_PREFIX)
 * - Handles both paginated envelope { success, data: [...], meta } and non-paginated array responses
 * - Displays records in a table styled per Ocean Professional theme
 * - Shows environment hints for API connectivity/debugging in development
 *
 * Column syncing strategy:
 * - Only show fields that exist in the live data.
 * - Constrain to the collection's allowed fields to avoid rendering unknown or deprecated fields.
 */
export default function UsersList({
  title = "Users",
  subtitle = "All users",
  showActions = true,
  // Optional Tabs config: [{ key:'all', label:'All' }, ...]
  tabs,
  initialTabKey = "all",
  onTabChange,
}) {
  const [allItems, setAllItems] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [query, setQuery] = useState("");
  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });
  const [activeTab, setActiveTab] = useState(initialTabKey || (Array.isArray(tabs) && tabs[0]?.key) || "all");

  // Allowed users fields per request (strict schema alignment)
  const allowedFields = useMemo(
    () => [
      "_id",
      "name",
      "email",
      "contact_number",
      "department",
      "organization_id",
      "is_admin",
      "group_ids",
      "status",
      "created_at",
      "updated_at",
    ],
    []
  );

  // Build columns by intersecting allowedFields with the keys found in data
  const [columns, setColumns] = useState([
    // initial minimal placeholder; will be replaced after data load
    { key: "_id", label: "ID" },
  ]);

  function inferColumnsFromData(rows) {
    // Derive all keys present in the dataset
    const keys = new Set();
    (rows || []).forEach((doc) => {
      Object.keys(doc || {}).forEach((k) => keys.add(k));
    });

    // Compute intersection with allowed fields (order as allowedFields order)
    const presentAllowed = allowedFields.filter((f) => keys.has(f));

    // Always include _id for clarity if present
    const finalKeys = presentAllowed.length ? presentAllowed : ["_id"];

    const toLabel = (k) =>
      k === "_id"
        ? "ID"
        : k
            .replace(/_/g, " ")
            .replace(/\b\w/g, (m) => m.toUpperCase());

    // Render helpers for dates; otherwise default
    const cols = finalKeys.map((k) => {
      if (k === "created_at" || k === "updated_at") {
        return {
          key: k,
          label: toLabel(k),
          render: (v) => (v ? new Date(v).toLocaleString() : "—"),
          priority: 3,
        };
      }
      return { key: k, label: toLabel(k) };
    });

    // Preserve stable ID column at end if not already last
    // Not necessary but helps UX; keep order per allowedFields already places _id first, so leave as-is.

    setColumns(cols);
  }

  async function load(page = 1, limit = meta.limit || 10) {
    setLoading(true);
    setError("");
    try {
      const res = await listUsers({ page, limit });
      const arr = Array.isArray(res) ? res : res?.items || [];
      setAllItems(arr);
      setItems(arr);
      if (res && res.meta) {
        setMeta({ page: res.meta.page || page, limit: res.meta.limit || limit, total: res.meta.total || arr.length });
      } else {
        setMeta({ page: 1, limit, total: arr.length });
      }
      inferColumnsFromData(arr);
    } catch (e) {
      setAllItems([]);
      setItems([]);
      setColumns([{ key: "_id", label: "ID" }]);
      setMeta({ page: 1, limit: 10, total: 0 });
      setError(e?.response?.data?.message || e?.message || "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Client-side filter across known user fields
  useEffect(() => {
    const q = (query || "").trim().toLowerCase();

    // First apply tab-based filtering if activeTab is not "all"
    let base = allItems || [];
    const tabKey = String(activeTab || "").toLowerCase();
    if (tabKey && tabKey !== "all") {
      base = base.filter((u) => String(u?.status ?? "").toLowerCase().includes(tabKey));
    }

    // Then apply text search across allowed fields
    if (!q) {
      setItems(base);
      return;
    }
    const filtered = (base || []).filter((u) => {
      const vals = allowedFields
        .map((f) => u?.[f])
        .concat([u?.id]) // friendly id if present
        .filter((v) => v !== undefined && v !== null)
        .map((v) => String(v).toLowerCase());
      return vals.some((v) => v.includes(q));
    });
    setItems(filtered);
  }, [query, allItems, allowedFields, activeTab]);

  // Optional: delete action stub; actual delete handled by page-level component if passed.
  function onDelete(row) {
    setConfirmDelete(row);
  }

  function closeDelete() {
    setConfirmDelete(null);
  }

  // Env hint removed to keep Users section clean and minimal

  return (
    <div>
      <Card title={title} subtitle={subtitle}>
        {Array.isArray(tabs) && tabs.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <Tabs
              tabs={tabs}
              activeKey={activeTab}
              onChange={(k) => {
                setActiveTab(k);
                if (typeof onTabChange === "function") onTabChange(k);
              }}
              aria-label="Users tabs"
            />
          </div>
        )}

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
            // Forward filter to API only if desired; here we retain client search, so refresh full page from server.
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
