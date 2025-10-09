import React, { useEffect, useMemo, useState } from "react";
import UsersList from "../../components/UsersList.jsx";
import TabbedUserModal from "../../components/users/TabbedUserModal.jsx";
import UsersByTenantChart from "../../components/charts/UsersByTenantChart.jsx";
import UsersOverTimeChart from "../../components/users/UsersOverTimeChart.jsx";

/**
 * PUBLIC_INTERFACE
 * Users page
 * Refactored to use a single TabbedUserModal that merges Profile (Details) and Projects into tabs.
 * - Centralizes selectedUser and modal open state in this page.
 * - When selecting a user from UsersList, opens the modal with defaultTab="details".
 * - When invoking "View Projects" triggers, opens with defaultTab="projects".
 *
 * Enhancement:
 * - Integrates UsersByTenantBarChart above the users table, wired to date range and tenant filters
 *   (uses a simple relative date window for consistency with existing histogram controls).
 */
export default function Users() {
  // Centralized state for one modal
  const [open, setOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [defaultTab, setDefaultTab] = useState("details"); // 'details' | 'projects'

  // Local filter state for the chart to stay consistent across the page.
  // We keep a simple relative date window like the histogram (default 30 days).
  const [rangeDays, setRangeDays] = useState(30);
  // Selected tenant is derived from the selected user when a row is opened; otherwise empty (all tenants).
  const selectedTenantId = useMemo(() => {
    const u = selectedUser || {};
    return (
      u.tenant_id ??
      u.organization_name ??
      u.organization ??
      u.organization_id ??
      ""
    );
  }, [selectedUser]);

  // Compute from/to ISO using relative window; recomputed when rangeDays changes.
  const { fromIso, toIso } = useMemo(() => {
    const now = new Date();
    const from = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000);
    return { fromIso: from.toISOString(), toIso: now.toISOString() };
  }, [rangeDays]);

  // Called when a user is chosen from UsersList (row click)
  function handleUserSelect(user) {
    setSelectedUser(user);
    setDefaultTab("details");
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
  }

  // Dim/deactivate headbar while modal is open
  useEffect(() => {
    const body = document?.body;
    if (!body) return;

    const CLASS = "modal-open--dim-header";
    const apply = () => {
      if (open) {
        body.classList.add(CLASS);
        // Mark the header as hidden from assistive tech while modal is active
        const headerEl = document.querySelector(".app-headbar, .topbar");
        if (headerEl) {
          headerEl.setAttribute("aria-hidden", "true");
        }
      } else {
        body.classList.remove(CLASS);
        const headerEl = document.querySelector(".app-headbar, .topbar");
        if (headerEl) {
          headerEl.removeAttribute("aria-hidden");
        }
      }
    };

    apply();
    return () => {
      body.classList.remove(CLASS);
      const headerEl = document.querySelector(".app-headbar, .topbar");
      if (headerEl) {
        headerEl.removeAttribute("aria-hidden");
      }
    };
  }, [open]);

  // Inline controls for the chart to align with existing patterns (Ocean Professional style).
  const chartToolbar = (
    <div className="toolbar" aria-label="Users by tenant filters" style={{ marginBottom: 8 }}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: "#6B7280" }}>Date range</span>
        <select
          aria-label="Date range"
          value={rangeDays}
          onChange={(e) => setRangeDays(Number(e.target.value))}
          style={{
            padding: "6px 8px",
            borderRadius: 8,
            border: "1px solid #d1d5db",
            background: "white",
            color: "#111827",
          }}
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </label>
      <div className="spacer" />
      {/* Tenant filter is implicitly applied by UsersList table; for the chart we scope to the selected user tenant when a user is opened.
          If no user is selected, we show all tenants to provide an overview. */}
    </div>
  );

  return (
    <div>
      {/* New Users Over Time chart */}
      <div style={{ marginBottom: 12 }}>
        <div className="card">
          <div className="card-content" style={{ paddingTop: 16 }}>
            <UsersOverTimeChart />
          </div>
        </div>
      </div>

      {/* Users by Tenant chart above the table */}
      <div style={{ marginBottom: 12 }}>
        <div className="card">
          <div className="card-header" style={{ paddingBottom: 0 }}>
            <div>
              <h3 className="card-title">Users by Tenant</h3>
              <div className="card-subtitle">Distinct active users by tenant</div>
            </div>
            <div className="card-actions">{chartToolbar}</div>
          </div>
          <div className="card-content">
            <UsersByTenantChart
              from={fromIso}
              to={toIso}
              status={"completed|active"}
              includeInactive={false}
              maxBars={12}
              onBarClick={(item) => {
                // Future: filter table by tenant
                // eslint-disable-next-line no-console
                console.debug("Tenant bar clicked:", item);
              }}
            />
          </div>
        </div>
      </div>

      <UsersList
        title="Users"
        subtitle="All users"
        showActions={false}
        onUserSelect={handleUserSelect}
      />

      {/* Spacer preserved after removing helper text and button to maintain layout rhythm */}
      <div style={{ marginTop: 12 }} aria-hidden="true" />

      {/* Single tabbed modal: Details and Projects */}
      <TabbedUserModal
        open={open}
        onClose={closeModal}
        user={selectedUser}
        tenantId={selectedTenantId}
        defaultTab={defaultTab}
      />
    </div>
  );
}
