import React, { useEffect, useMemo, useState } from "react";
import Card from "./ui/Card.jsx";
import DataTable from "./DataTable.jsx";
import Button from "./ui/Button.jsx";
import UserProfileModal from "./UserProfileModal.jsx";
import { listUsers } from "../api/client";

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
 * - Tenant Id column resolves in priority: tenant_id -> organization_name -> organization -> organization_id.
 * - All other fields are hidden from the UI.
 * - Search covers these fields only to stay aligned with visible columns.
 *
 * Enhancement:
 * - Changes filter control to Organization (replacing Department). Includes a "Reset" button to clear filters.
 */
export default function UsersList({ title = "Users", subtitle = "All users", showActions = false }) {
  const [allItems, setAllItems] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null); // kept for parity; actions disabled by default
  const [query, setQuery] = useState("");

  // New: Tenant filter (instant)
  const [organizationFilter, setOrganizationFilter] = useState("");

  const [meta, setMeta] = useState({ page: 1, limit: 6, total: 0 });

  // Modal: user profile
  const [selectedUser, setSelectedUser] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);

  // While the profile modal is open, make the global header (Topbar) inaccessible:
  // - inert: prevents focus and interaction in supported browsers
  // - aria-hidden: hide from assistive tech
  // - topbar--dimmed: visual dim and pointer-events disabled as a fallback
  useEffect(() => {
    const header = document.querySelector(".topbar");
    if (!header) return;

    if (profileOpen) {
      try {
        header.setAttribute("inert", "");
        header.setAttribute("aria-hidden", "true");
        header.classList.add("topbar--dimmed");
      } catch {
        // no-op
      }
    } else {
      try {
        header.removeAttribute("inert");
        header.removeAttribute("aria-hidden");
        header.classList.remove("topbar--dimmed");
      } catch {
        // no-op
      }
    }

    // Cleanup to ensure header is restored if component unmounts while modal is open
    return () => {
      try {
        header.removeAttribute("inert");
        header.removeAttribute("aria-hidden");
        header.classList.remove("topbar--dimmed");
      } catch {
        // no-op
      }
    };
  }, [profileOpen]);

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

  // Load ALL users once (no server pagination) so filters are applied globally before pagination.
  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await listUsers({});
      const arr = res?.items ?? (Array.isArray(res) ? res : []);
      setAllItems(arr);
      setItems(arr);
      setMeta((prev) => ({ page: 1, limit: prev.limit || 6, total: arr.length }));
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
  // Applies both text search and organization filter instantly, then updates total to reflect filtered count.
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

  // Optional: delete action stub; no actions shown by default.
  function onDelete(row) {
    setConfirmDelete(row);
  }

  function closeDelete() {
    setConfirmDelete(null);
  }

  // Reset all filters to show full user list instantly
  function resetFilters() {
    setQuery("");
    setOrganizationFilter("");
    setItems(allItems);
    setMeta((m) => ({ ...m, total: allItems.length, page: 1 }));
  }

  function onRowClick(user) {
    setSelectedUser(user);
    setProfileOpen(true);
  }

  function closeProfile() {
    setProfileOpen(false);
    setSelectedUser(null);
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
        {error && (
          <div className="error" role="alert" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}
        <DataTable
          key={tableKey}
          columns={columns}
          data={items}
          loading={loading}
          onDelete={showActions ? onDelete : undefined}
          onRowClick={onRowClick}
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

      <UserProfileModal
        open={profileOpen}
        onClose={closeProfile}
        user={selectedUser}
      />
    </div>
  );
}
