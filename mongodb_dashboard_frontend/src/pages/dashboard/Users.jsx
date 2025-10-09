import React, { useEffect, useMemo, useState, useCallback } from "react";
import UsersList from "../../components/UsersList.jsx";
import TabbedUserModal from "../../components/users/TabbedUserModal.jsx";
import UsersByTenantChart from "../../components/charts/UsersByTenantChart.jsx";
import UsersOverTimeChart from "../../components/users/UsersOverTimeChart.jsx";
import { fetchNewUsersOverTime } from "../../api/usersAnalyticsNewOverTime";

/**
 * PUBLIC_INTERFACE
 * Users page
 * Shows "New Users Over Time – All Data" without granularity filters.
 * Existing content (tenant chart, users list, modal) preserved.
 */
export default function Users() {
  // For UsersOverTimeChart
  const [series, setSeries] = useState([]);
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [seriesError, setSeriesError] = useState(null);

  const loadSeries = useCallback(async () => {
    setSeriesLoading(true);
    setSeriesError(null);
    try {
      const res = await fetchNewUsersOverTime();
      setSeries(res?.items ?? []);
    } catch (e) {
      setSeriesError(e?.message || "Failed to load new users over time");
    } finally {
      setSeriesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSeries();
  }, [loadSeries]);

  // Existing state (from prior implementation) retained
  const [open, setOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [defaultTab, setDefaultTab] = useState("details"); // 'details' | 'projects'

  const [rangeDays, setRangeDays] = useState(30);
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

  const { fromIso, toIso } = useMemo(() => {
    const now = new Date();
    const from = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000);
    return { fromIso: from.toISOString(), toIso: now.toISOString() };
  }, [rangeDays]);

  function handleUserSelect(user) {
    setSelectedUser(user);
    setDefaultTab("details");
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
  }

  useEffect(() => {
    const body = document?.body;
    if (!body) return;

    const CLASS = "modal-open--dim-header";
    const apply = () => {
      if (open) {
        body.classList.add(CLASS);
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
    </div>
  );

  return (
    <div>
      {/* New Users Over Time chart */}
      <div style={{ marginBottom: 12 }}>
        <div className="card">
          <div className="card-content" style={{ paddingTop: 16 }}>
            <UsersOverTimeChart data={series} loading={seriesLoading} error={seriesError} />
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

      <div style={{ marginTop: 12 }} aria-hidden="true" />

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
