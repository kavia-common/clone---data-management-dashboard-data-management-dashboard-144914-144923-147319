import React, { useEffect, useMemo, useState } from "react";
import Card from "./ui/Card.jsx";
import DataTable from "./DataTable.jsx";
import Button from "./ui/Button.jsx";
import { listUsers } from "../api/client";

// Helper to format number to currency-like string with 2 decimals
function formatMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0.00";
  return x.toFixed(2);
}

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
 *
 * @param {{ title?: string, subtitle?: string, showActions?: boolean, onUserSelect?: (user:any)=>void, onUserRowClick?: (user:any)=>void }} props
 */
export default function UsersList({ title = "Users", subtitle = "All users", showActions = false, onUserSelect, onUserRowClick }) {
  const [allItems, setAllItems] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null); // kept for parity; actions disabled by default
  const [query, setQuery] = useState("");

  // New: Tenant filter (instant)
  const [organizationFilter, setOrganizationFilter] = useState("");

  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });

  // Aggregated costs state
  const [costsLoading, setCostsLoading] = useState(false);
  const [userCostsMap, setUserCostsMap] = useState({}); // { userIdString: number }
  const [projectsByOwner, setProjectsByOwner] = useState({}); // { ownerUserIdString: [project] }

  // Modal state
  const [detailsUser, setDetailsUser] = useState(null);

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
    const renderCost = (v, row) => {
      const id = String(row?._id || "");
      const cost = userCostsMap[id] ?? 0;
      return `$${formatMoney(cost)}`;
    };
    const renderActions = (v, row) => {
      return (
        <Button
          variant="primary"
          onClick={(e) => {
            e.stopPropagation();
            openDetails(row);
          }}
          title="View LLM cost details"
          aria-label="View LLM cost details"
        >
          Details
        </Button>
      );
    };
    return [
      { key: "name", label: "Name", priority: 1 },
      { key: "__tenant", label: "Tenant Id", render: renderTenant, priority: 2 },
      { key: "email", label: "Mail", priority: 2 },
      { key: "department", label: "Department", priority: 3 },
      { key: "__llm_cost", label: "LLM Cost", render: renderCost, priority: 2 },
      { key: "__actions", label: "", render: renderActions, priority: 4 },
    ];
  }, [userCostsMap]);

  // Load ALL users once (no server pagination) so filters are applied globally before pagination.
  async function load() {
    setLoading(true);
    setError("");
    try {
      // Fetch users
      const res = await listUsers({});
      const arr = res?.items ?? (Array.isArray(res) ? res : []);

      // Fetch aggregated costs
      setCostsLoading(true);
      let agg = { users: [], projects: [] };
      try {
        const resp = await fetch("/api/llm-costs");
        if (resp.ok) {
          agg = await resp.json();
        }
      } catch (e) {
        // ignore; fallback to 0 costs
      } finally {
        setCostsLoading(false);
      }

      // Build maps
      const uMap = {};
      (agg.users || []).forEach((u) => {
        const id = String(u?._id || "");
        const cost = Number(u?.user_cost || 0);
        if (id) uMap[id] = Number.isFinite(cost) ? cost : 0;
      });
      const projByOwner = {};
      (agg.projects || []).forEach((p) => {
        const owner = p?.ownerUserId != null ? String(p.ownerUserId) : null;
        if (!owner) return;
        if (!projByOwner[owner]) projByOwner[owner] = [];
        projByOwner[owner].push({
          _id: p?._id,
          name: p?.name || p?.project_name || p?.project_id || "Untitled",
          project_cost: Number(p?.project_cost || 0),
        });
      });

      setUserCostsMap(uMap);
      setProjectsByOwner(projByOwner);

      setAllItems(arr);
      setItems(arr);
      setMeta((prev) => ({ page: 1, limit: prev.limit || 10, total: arr.length }));
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

  // Row click: delegate to parent only (stateless regarding profile modal)
  function openDetails(user) {
    setDetailsUser(user);
  }

  function closeDetails() {
    setDetailsUser(null);
  }

  function handleRowClick(user) {
    try {
      if (typeof onUserRowClick === "function") {
        onUserRowClick(user);
        return;
      }
      if (typeof onUserSelect === "function") onUserSelect(user);
      // default behavior: open details modal
      openDetails(user);
    } catch {
      // ignore external callback errors
    }
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
          onRowClick={handleRowClick}
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

      {detailsUser && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="User LLM cost details">
          <div
            className="modal-card"
            style={{
              maxWidth: 720,
              borderRadius: 12,
              boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
              background: "#ffffff",
            }}
          >
            <div
              className="modal-header"
              style={{
                borderBottom: "1px solid #e5e7eb",
                padding: "12px 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "linear-gradient(180deg, rgba(37,99,235,0.06), transparent)",
                borderTopLeftRadius: 12,
                borderTopRightRadius: 12,
              }}
            >
              <h3 style={{ margin: 0, color: "#111827" }}>User LLM Cost Details</h3>
              <Button variant="ghost" aria-label="Close details" onClick={closeDetails}>
                ✕
              </Button>
            </div>

            <div className="modal-body" style={{ padding: 16 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>Name</div>
                  <div style={{ fontWeight: 600 }}>{detailsUser?.name || "—"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>Email</div>
                  <div>{detailsUser?.email || "—"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>Tenant</div>
                  <div>
                    {detailsUser?.tenant_id ||
                      detailsUser?.organization_name ||
                      detailsUser?.organization ||
                      detailsUser?.organization_id ||
                      "—"}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>User LLM Cost</div>
                  <div style={{ color: "#2563EB", fontWeight: 700 }}>
                    ${formatMoney(userCostsMap[String(detailsUser?._id || "")] ?? 0)}
                  </div>
                </div>
              </div>

              <div
                style={{
                  borderTop: "1px solid #e5e7eb",
                  paddingTop: 12,
                  marginTop: 8,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 8, color: "#111827" }}>Projects</div>
                {(() => {
                  const ownerId = String(detailsUser?._id || "");
                  const plist = projectsByOwner[ownerId] || [];
                  if (plist.length === 0) {
                    return <div style={{ color: "#6b7280" }}>No projects found for this user.</div>;
                  }
                  const totalProjectCost = plist.reduce((acc, p) => acc + (Number(p?.project_cost || 0) || 0), 0);
                  const grandTotal = totalProjectCost + (userCostsMap[ownerId] || 0);

                  return (
                    <div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                        <div style={{ fontSize: 12, color: "#6b7280" }}>Project Name</div>
                        <div style={{ fontSize: 12, color: "#6b7280", textAlign: "right" }}>Project Cost</div>
                      </div>
                      {plist.map((p) => (
                        <div
                          key={String(p?._id || p?.name)}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr auto",
                            gap: 8,
                            padding: "8px 0",
                            borderBottom: "1px dashed #e5e7eb",
                          }}
                        >
                          <div>{p?.name || "Untitled"}</div>
                          <div style={{ textAlign: "right" }}>${formatMoney(p?.project_cost || 0)}</div>
                        </div>
                      ))}

                      <div style={{ paddingTop: 8 }}>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr auto",
                            fontWeight: 700,
                            color: "#111827",
                          }}
                        >
                          <div>Total project cost</div>
                          <div style={{ textAlign: "right" }}>${formatMoney(totalProjectCost)}</div>
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr auto",
                            color: "#111827",
                            marginTop: 4,
                          }}
                        >
                          <div>User cost</div>
                          <div style={{ textAlign: "right" }}>
                            ${formatMoney(userCostsMap[ownerId] || 0)}
                          </div>
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr auto",
                            fontWeight: 800,
                            color: "#2563EB",
                            marginTop: 6,
                          }}
                        >
                          <div>Grand total</div>
                          <div style={{ textAlign: "right" }}>${formatMoney(grandTotal)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            <div
              className="modal-footer"
              style={{
                borderTop: "1px solid #e5e7eb",
                padding: 12,
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                borderBottomLeftRadius: 12,
                borderBottomRightRadius: 12,
              }}
            >
              <div className="modal-actions">
                <Button variant="secondary" onClick={closeDetails} title="Close">
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
