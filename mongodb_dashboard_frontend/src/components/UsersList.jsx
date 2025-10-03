import React, { useMemo, useState } from "react";
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
 * - Data is sourced exclusively from the centralized DataContext and cached at app mount.
 * - Tenant Id column resolves in priority: tenant_id -> organization_name -> organization -> organization_id.
 * - Search covers these fields only to stay aligned with visible columns.
 * - Includes a Refresh control that triggers DataContext refreshUsers.
 */
export default function UsersList({ title = "Users", subtitle = "All users", showActions = false }) {
  // Centralized cached data from DataContext
  const { users, usersLoading, usersError, refreshUsers } = useDataContext();

  // Local UI state for client-side filtering
  const [query, setQuery] = useState("");
  const [organizationFilter, setOrganizationFilter] = useState("");

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

  // Unique tenant options derived from context users (kept stable via useMemo)
  const organizationOptions = useMemo(() => {
    const set = new Set();
    (users || []).forEach((u) => {
      const orgVal = u?.tenant_id ?? u?.organization_name ?? u?.organization ?? u?.organization_id;
      if (orgVal !== undefined && orgVal !== null) {
        const s = String(orgVal).trim();
        if (s) set.add(s);
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [users]);

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

  // Apply search and tenant filter instantly on cached users
  const filteredItems = useMemo(() => {
    const q = (query || "").trim().toLowerCase();
    let filtered = users || [];

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

    return filtered;
  }, [users, query, allowedFields, organizationFilter]);

  // Reset filters to show full list
  function resetFilters() {
    setQuery("");
    setOrganizationFilter("");
  }

  // Force DataTable to reset pagination to page 1 whenever filters or search change
  const tableKey = useMemo(
    () => `${(query || "").trim().toLowerCase()}|${organizationFilter}|${filteredItems.length}`,
    [query, organizationFilter, filteredItems.length]
  );

  return (
    <div>
      <Card
        title={title}
        subtitle={subtitle}
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button
              variant="secondary"
              onClick={resetFilters}
              aria-label="Reset filters"
              title="Reset filters"
            >
              Reset
            </Button>
            <Button
              variant="primary"
              onClick={refreshUsers}
              aria-label="Refresh users"
              title="Refresh users"
              disabled={usersLoading}
            >
              Refresh
            </Button>
          </div>
        }
      >
        <div className="toolbar" aria-label="Users toolbar">
          <input
            className="input-search"
            placeholder="Search users..."
            aria-label="Search users"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {/* Tenant filter */}
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

          <div className="spacer" />
        </div>

        {usersError && (
          <div className="error" role="alert" style={{ marginBottom: 12 }}>
            {usersError}
          </div>
        )}
        <DataTable
          key={tableKey}
          columns={columns}
          data={filteredItems}
          loading={usersLoading}
          onDelete={showActions ? () => {} : undefined}
          pageSize={10}
          initialPage={1}
          paginationTitle="Users pages"
        />
      </Card>
    </div>
  );
}
