import React, { useEffect, useMemo, useState } from "react";
import UsersList from "../../components/UsersList.jsx";
import TabbedUserModal from "../../components/users/TabbedUserModal.jsx";
import UsersByTenantChart from "../../components/charts/UsersByTenantChart.jsx";
import UsersDepartmentChart from "../../modules/users/UsersDepartmentChart.jsx";
import DateRangeFilter from "../../components/common/DateRangeFilter";
import useDateRangeQuery from "../../hooks/useDateRangeQuery";

export default function Users() {
  const [open, setOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [defaultTab, setDefaultTab] = useState("details");
  const [rangeDays, setRangeDays] = useState(30);

  const { startDate, endDate, setDates, clearDates, withDateParams } = useDateRangeQuery();

  // ✅ Build date params consistently using the hook (includes proper day-boundary ISO normalization)
  const dateParams = useMemo(() => {
    return withDateParams({ status: "completed|active" });
  }, [startDate, endDate, withDateParams]);

  // ✅ Compute fallback quick range for charts
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
              {...dateParams}
              from={startDate ? undefined : fromIso}
              to={endDate ? undefined : toIso}
              status={"completed|active"}
              includeInactive={false}
              maxBars={12}
            />
          </div>
        </div>
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

      {/* Users List */}
      <UsersList
        title="Users"
        subtitle="All users"
        showActions={false}
        onUserSelect={handleUserSelect}
        startDate={startDate}
        endDate={endDate}
        onDateChange={setDates}
        onClearDate={clearDates}
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
