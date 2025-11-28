import React, { useEffect, useMemo, useState } from "react";
import UsersList from "../../components/UsersList.jsx";
import TabbedUserModal from "../../components/users/TabbedUserModal.jsx";
import UsersDepartmentChart from "../../modules/users/UsersDepartmentChart.jsx";
import UsersAnalyticsPanel from "../../modules/users/UsersAnalyticsPanel.jsx";

export default function Users() {
  const [open, setOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [defaultTab, setDefaultTab] = useState("details");

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

  // Accessibility toggle for modal overlay
  useEffect(() => {
    document.body.classList.toggle("modal-open--dim-header", open);
    const headerEl = document.querySelector(".app-headbar, .topbar");
    if (headerEl) {
      if (open) headerEl.setAttribute("aria-hidden", "true");
      else headerEl.removeAttribute("aria-hidden");
    }
  }, [open]);

  return (
    <div>
      {/* Users Analytics Panel */}
      <UsersAnalyticsPanel style={{ marginBottom: 12 }} />

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
