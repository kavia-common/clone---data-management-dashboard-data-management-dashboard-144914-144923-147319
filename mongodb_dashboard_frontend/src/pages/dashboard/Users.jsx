import React, { useMemo, useState } from "react";
import UsersList from "../../components/UsersList.jsx";
import UserProjectsModal from "../../components/users/UserProjectsModal.jsx";

/**
 * PUBLIC_INTERFACE
 * Users page
 * Container page that reuses the shared UsersList component and provides a modal to view a user's projects.
 * The UsersList opens a profile modal on row click and also bubbles selection up via onUserSelect.
 */
export default function Users() {
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  function handleOpenProjects() {
    if (!selectedUser) return;
    setProjectsOpen(true);
  }
  function handleCloseProjects() {
    setProjectsOpen(false);
  }

  // Derive tenant id from user object using known keys
  const tenantId = useMemo(() => {
    const u = selectedUser || {};
    return u.tenant_id ?? u.organization_name ?? u.organization ?? u.organization_id ?? "";
  }, [selectedUser]);

  return (
    <div>
      <UsersList
        title="Users"
        subtitle="All users"
        showActions={false}
        onUserSelect={(u) => setSelectedUser(u)}
      />

      {/* Action row: show current selection and View button */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, gap: 8, flexWrap: "wrap" }}>
        <div className="muted" style={{ fontSize: 12 }}>
          {selectedUser
            ? `Selected: ${selectedUser.name || selectedUser.full_name || selectedUser.email || selectedUser._id || "User"}`
            : "Select a user row to enable View Projects"}
        </div>
        <button
          className="btn btn-primary"
          onClick={handleOpenProjects}
          disabled={!selectedUser || !tenantId}
          title={selectedUser && tenantId ? "View projects for selected user" : "Select a user first"}
        >
          View Selected User Projects
        </button>
      </div>

      {/* Projects modal */}
      <UserProjectsModal
        open={projectsOpen}
        onClose={handleCloseProjects}
        userId={selectedUser?._id || selectedUser?.id || ""}
        tenantId={tenantId || ""}
        userName={selectedUser?.name || selectedUser?.full_name || selectedUser?.email || ""}
      />
    </div>
  );
}
