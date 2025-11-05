import React, { useEffect, useMemo, useState } from "react";
import UsersList from "../../components/UsersList.jsx";
import TabbedUserModal from "../../components/users/TabbedUserModal.jsx";
import UsersByTenantChart from "../../components/charts/UsersByTenantChart.jsx";
import UsersDepartmentChart from "../../modules/users/UsersDepartmentChart.jsx";
import ActiveUsersList from "../../components/users/ActiveUsersList.jsx";
import ActiveUsersTrendChart from "../../components/charts/ActiveUsersTrendChart.jsx";
import useActiveUsersTrend from "../../hooks/useActiveUsersTrend";
import MostActiveUsersBarChart from "../../components/charts/MostActiveUsersBarChart.jsx";

export default function Users() {
  const [open, setOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [defaultTab, setDefaultTab] = useState("details");
  const [rangeDays, setRangeDays] = useState(30);

  // Compute quick range for charts (no URL dates)
  const { fromIso, toIso } = useMemo(() => {
    const now = new Date();
    const from = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000);
    return { fromIso: from.toISOString(), toIso: now.toISOString() };
  }, [rangeDays]);

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

  function handleUserSelect(user) {
    setSelectedUser(user);
    setDefaultTab("details");
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
  }

  // ✅ Accessibility toggle for modal overlay
  useEffect(() => {
    document.body.classList.toggle("modal-open--dim-header", open);
    const headerEl = document.querySelector(".app-headbar, .topbar");
    if (headerEl) {
      if (open) headerEl.setAttribute("aria-hidden", "true");
      else headerEl.removeAttribute("aria-hidden");
    }
  }, [open]);

  const chartToolbar = (
    <div
      className="toolbar"
      style={{ marginBottom: 8, gap: 8, display: "flex", alignItems: "center" }}
    >
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
          Quick range
        </span>
        <select
          aria-label="Date range"
          value={rangeDays}
          onChange={(e) => setRangeDays(Number(e.target.value))}
          className="ui-input"
          style={{ minWidth: 160 }}
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </label>
    </div>
  );

  // Active Users Trend hook state (separate from UsersByTenant range control)
  const {
    loading: trendLoading,
    error: trendError,
    items: trendItems,
    controls: trendControls,
  } = useActiveUsersTrend({ days: 30, granularity: "day" });

  return (
    <div>
      {/* Users by Tenant Chart */}
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
            />
          </div>
        </div>
      </div>

      {/* Active Users Trend Chart */}
      <div style={{ marginBottom: 12 }}>
        <ActiveUsersTrendChart
          data={trendItems}
          loading={trendLoading}
          error={trendError}
          controls={trendControls}
        />
      </div>

      {/* Most Active Users Bar Chart */}
      <div style={{ marginBottom: 12 }}>
        <MostActiveUsersBarChart initialWindow={30} initialTopN={10} />
      </div>

      {/* Users by Department Chart */}
      <div style={{ marginBottom: 12 }}>
        <div className="card">
          <div className="card-header" style={{ paddingBottom: 0 }}>
            <h3 className="card-title">Users by Department</h3>
            <div className="card-subtitle">Count of users per department</div>
          </div>
          <div className="card-content">
            <UsersDepartmentChart variant="bar" height={340} />
          </div>
        </div>
      </div>

      {/* Active Users List */}
      <div style={{ marginBottom: 12 }}>
        <ActiveUsersList
          page={1}
          limit={20}
          sort="-created_at"
          onRowClick={handleUserSelect}
        />
      </div>

      {/* Users List */}
      <UsersList
        title="Users"
        subtitle="All users"
        showActions={false}
        onUserSelect={handleUserSelect}
      />

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
