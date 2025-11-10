import React, { useEffect, useMemo, useState } from "react";
import Card from "./ui/Card.jsx";
import DataTable from "./DataTable.jsx";
import Button from "./ui/Button.jsx";
import { listUsers } from "../api";

/**
 * PUBLIC_INTERFACE
 * UsersList
 * Displays users with filters: search and tenant.
 * Fetches data from API without date range filters.
 */
export default function UsersList({
  title = "Users",
  subtitle = "All users",
  showActions = false,
  onUserSelect,
  onUserRowClick,
}) {
  const [allItems, setAllItems] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [query, setQuery] = useState("");
  const [organizationFilter, setOrganizationFilter] = useState("");
  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });

  const allowedFields = useMemo(
    () => [
      "name",
      "email",
      "department",
      "tenant_id",
      "organization_name",
      "organization",
      "organization_id",
    ],
    []
  );

  const columns = useMemo(() => {
    const renderTenant = (v, row) =>
      row?.tenant_id ||
      row?.organization_name ||
      row?.organization ||
      row?.organization_id ||
      "—";
    return [
      { key: "name", label: "Name", priority: 1 },
      { key: "__tenant", label: "Tenant Id", render: renderTenant, priority: 2 },
      { key: "email", label: "Mail", priority: 2 },
      { key: "department", label: "Department", priority: 3 },
    ];
  }, []);

  // PUBLIC_INTERFACE
  async function load() {
    setLoading(true);
    setError("");
    try {
      // listUsers routes through shared client enforcing /api/users?organization_id=<ORG_ID> only.
      const res = await listUsers({});
      const arr = res?.items ?? (Array.isArray(res) ? res : []);
      setAllItems(arr);
      setItems(arr);
      setMeta((prev) => ({
        page: 1,
        limit: prev.limit || 10,
        total: arr.length,
      }));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const q = (query || "").trim().toLowerCase();
    let filtered = allItems || [];

    if (q) {
      filtered = filtered.filter((u) => {
        const vals = allowedFields
          .map((f) => u?.[f])
          .filter((v) => v !== undefined && v !== null)
          .map((v) => String(v).toLowerCase());
        return vals.some((v) => v.includes(q));
      });
    }

    if (organizationFilter) {
      filtered = filtered.filter((u) => {
        const org =
          u?.tenant_id ?? u?.organization_name ?? u?.organization ?? u?.organization_id;
        return String(org ?? "").trim() === organizationFilter;
      });
    }

    setItems(filtered);
    setMeta((m) => ({ ...m, total: filtered.length, page: 1 }));
  }, [query, allItems, allowedFields, organizationFilter]);

  function resetFilters() {
    setQuery("");
    setOrganizationFilter("");
    setItems(allItems);
    setMeta((m) => ({ ...m, total: allItems.length, page: 1 }));
    load();
  }

  function handleRowClick(user) {
    try {
      if (typeof onUserRowClick === "function") return onUserRowClick(user);
      if (typeof onUserSelect === "function") onUserSelect(user);
    } catch {
      // ignore callback errors
    }
  }

  const tableKey = useMemo(
    () => `${(query || "").trim().toLowerCase()}|${organizationFilter}|${items.length}`,
    [query, organizationFilter, items.length]
  );

  return (
    <div>
      <Card title={title} subtitle={subtitle}>
        <div
          className="toolbar"
          aria-label="Users toolbar"
          style={{ flexWrap: "wrap", gap: 8, display: "flex", alignItems: "center" }}
        >
          {/* 🔎 Search */}
          <input
            className="input-search"
            placeholder="Search users..."
            aria-label="Search users"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {/* 🏢 Tenant Filter */}
          <select
            aria-label="Filter by tenant"
            title="Filter by tenant"
            value={organizationFilter}
            onChange={(e) => setOrganizationFilter(e.target.value)}
            style={{ width: 200 }}
          >
            <option value="">All Tenant</option>
            {[...new Set(
              allItems.map(
                (u) =>
                  u?.tenant_id ??
                  u?.organization_name ??
                  u?.organization ??
                  u?.organization_id
              )
            )]
              .filter(Boolean)
              .sort()
              .map((org) => (
                <option key={org} value={org}>
                  {org}
                </option>
              ))}
          </select>

          {/* 🔁 Reset Button */}
          <Button
            variant="secondary"
            onClick={resetFilters}
            aria-label="Reset filters"
            title="Reset filters"
          >
            Reset
          </Button>
        </div>

        {/* ⚠️ Error Message */}
        {error && (
          <div className="error" role="alert" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}

        {/* 📋 Data Table */}
        <DataTable
          key={tableKey}
          columns={columns}
          data={items}
          loading={loading}
          onDelete={showActions ? (row) => setConfirmDelete(row) : undefined}
          onRowClick={handleRowClick}
          pageSize={meta.limit || 10}
          initialPage={1}
          paginationTitle="Users pages"
        />
      </Card>

      {/* 🗑️ Delete Modal */}
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
              <p>This is a placeholder delete dialog. Actual deletion logic goes in the parent page.</p>
            </div>
            <div className="modal-footer">
              <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
