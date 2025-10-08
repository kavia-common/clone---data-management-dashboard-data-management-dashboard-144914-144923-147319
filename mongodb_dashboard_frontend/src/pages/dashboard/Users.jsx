import React, { useEffect, useMemo, useState } from "react";
import UsersList from "../../components/UsersList.jsx";
import TabbedUserModal from "../../components/users/TabbedUserModal.jsx";
import UsersDurationHistogram from "../../components/users/UsersDurationHistogram.jsx";

/**
 * PUBLIC_INTERFACE
 * Users page
 * Refactored to use a single TabbedUserModal that merges Profile (Details) and Projects into tabs.
 * Adds a Session Duration Histogram above the Users table with tenant and scope controls.
 */
export default function Users() {
  // Centralized state for one modal
  const [open, setOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [defaultTab, setDefaultTab] = useState("details"); // 'details' | 'projects'
  const [selectedTenantId, setSelectedTenantId] = useState("");

  // Derive tenant id from user object using known keys
  const derivedTenantFromUser = useMemo(() => {
    const u = selectedUser || {};
    return (
      u.tenant_id ??
      u.tenantId ??
      u.organization_name ??
      u.organization ??
      u.organization_id ??
      ""
    );
  }, [selectedUser]);

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

  // Tenant options: currently derived from the UsersList internal data is not exposed.
  // As a simple fallback, build a list from the selected user and a derived tenant id if available.
  const tenantOptions = useMemo(() => {
    const opts = [];
    const current = selectedTenantId || derivedTenantFromUser;
    if (current) {
      opts.push({ value: String(current), label: String(current) });
    }
    return opts;
  }, [selectedTenantId, derivedTenantFromUser]);

  const selectedUserId = selectedUser?._id || selectedUser?.id || null;

  return (
    <div>
      {/* Session Duration Histogram */}
      <UsersDurationHistogram
        selectedUserId={selectedUserId}
        selectedTenantId={selectedTenantId || (tenantOptions[0]?.value ?? undefined)}
        tenantOptions={tenantOptions}
        onTenantChange={setSelectedTenantId}
        defaultDays={30}
        defaultBinSizeMin={10}
      />

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
        tenantId={selectedTenantId || derivedTenantFromUser}
        defaultTab={defaultTab}
      />
    </div>
  );
}
