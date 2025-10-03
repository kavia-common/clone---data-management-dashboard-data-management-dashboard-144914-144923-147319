import React, { useEffect, useMemo, useState } from "react";
import Card from "./ui/Card.jsx";
import DataTable from "./DataTable.jsx";
import Button from "./ui/Button.jsx";
import { useDataContext } from "../context/DataContext.jsx";

/**
 * PUBLIC_INTERFACE
 * UsersList
 * A reusable users list component configured to show ONLY these columns:
 * - Name
 * - Tenant Id
 * - Mail
 * - Department
 *
 * Notes:
 * - Data is sourced from DataContext (cached at app load). No network calls here.
 * - Tenant Id column resolves in priority: tenant_id -> organization_name -> organization -> organization_id.
 */
export default function UsersList({ title = "Users", subtitle = "All users", showActions = false }) {
  const { users, usersLoading, usersError } = useDataContext();

  const [allItems, setAllItems] = useState([]);
  const [items, setItems] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(null); // kept for parity; actions disabled by default
  const [query, setQuery] = useState("");

  // New: Tenant filter (instant)
  const [organizationFilter, setOrganizationFilter] = useState("");

  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });

  // Limit searchable fields to the visible columns (and their most likely underlying keys).
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

  // Seed local state from context when users data changes.
  useEffect(() => {
    const arr = Array.isArray(users) ? users : [];
    setAllItems(arr);
    setItems(arr);
    setMeta((m) => ({ ...m, page: 1, total: arr.length }));
  }, [users]);

  // Unique tenant options derived from the loaded data (kept stable via useMemo)
  const organizationOptions = useMemo(() => {
    const set = new Set();
    (allItems || []).forEach((u) => {
      const orgVal = u?.tenant_id ?? u?.organization_name ?? u?.organization ?? u?.organization_id;
      if (orgVal !== undefined && orgVal !== null) {
        const s = String(orgVal).trim();
        if (s) set.add(s);
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allItems]);

  // Fixed 4-column configuration, Ocean Professional compliant.
  const columns = useMemo(() => {
    const renderTenant = (v, row) =>
      row?.tenant_id || row?.organization_name || row?.organization || row?.organization_id || "—";
    return [
      { key: "name", label: "Name", priority: 1 },
      { key: "__tenant", label: "Tenant Id", render: renderTenant, priority: 2 },
      { key: "email", label: "Mail", priority: 2 },
      { key: "department", label: "Department", priority: 3 },
    ];
  }, []);

  // Client-side filter across only the fields that correspond to visible columns.
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
        const org = u?.tenant_id ?? u?.organization_name ?? u?.organization ?? u?.organization_id;
        return String(org ?? "").trim() === organizationFilter;
      });
    }

    setItems(filtered);
    setMeta((m) => ({ ...m, total: filtered.length, page: 1 }));
  }, [query, allItems, allowedFields, organizationFilter]);

  function onDelete(row) {
    setConfirmDelete(row);
  }

  function closeDelete() {
    setConfirmDelete(null);
  }

  function resetFilters() {
    setQuery("");
    setOrganizationFilter("");
    setItems(allItems);
    setMeta((m) => ({ ...m, total: allItems.length, page: 1 }));
  }

  // Force DataTable to reset pagination to page 1 whenever filters or search change
  const tableKey = useMemo(
    () => `${(query || "").trim().toLowerCase()}|${organizationFilter}|${items.length}`,
    [query, organizationFilter, items.length]
  );

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

          {/* Tenant filter + Reset button (immediately to the right) */}
          <select
            aria-label="Filter by tenant"
            title="Filter by tenant"
            value={organizationFilter}
            onChange={(e) => setOrganizationFilter(e.target.value)}
            style={{ width: 220 }}
          >
            <option value="">All Tenant</option>
            {organizationOptions.map((org) => (
              <option key={org} value={org}>
                {org}
              </option>
            ))}
          </select>

          <Button
            variant="secondary"
            onClick={resetFilters}
            aria-label="Reset filters"
            title="Reset filters"
          >
            Reset
          </Button>

          <div className="spacer" />
          {/* No Add button */}
        </div>
        {usersError && (
          <div className="error" role="alert" style={{ marginBottom: 12 }}>
            {usersError}
          </div>
        )}
        <DataTable
          key={tableKey}
          columns={columns}
          data={items}
          loading={!!usersLoading}
          onDelete={showActions ? onDelete : undefined}
          pageSize={meta.limit || 10}
          initialPage={1}
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
