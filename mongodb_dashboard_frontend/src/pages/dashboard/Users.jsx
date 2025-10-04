import React, { useEffect, useMemo, useState } from "react";
import UsersList from "../../components/UsersList.jsx";
import TabbedUserModal from "../../components/users/TabbedUserModal.jsx";

/**
 * PUBLIC_INTERFACE
 * Users page
 * Refactored to use a single TabbedUserModal that merges Profile (Details) and Projects into tabs.
 * - Centralizes selectedUser and modal open state in this page.
 * - When selecting a user from UsersList, opens the modal with defaultTab="details".
 * - When invoking "View Projects" triggers, opens with defaultTab="projects".
 */
export default function Users() {
  // Centralized state for one modal
  const [open, setOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [defaultTab, setDefaultTab] = useState("details"); // 'details' | 'projects'

  // Derive tenant id from user object using known keys
  const tenantId = useMemo(() => {
    const u = selectedUser || {};
    return u.tenant_id ?? u.organization_name ?? u.organization ?? u.organization_id ?? "";
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

  return (
    <div>
      {/* Pagination: UsersList standardizes page size to 8 rows per page */}
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
        tenantId={tenantId}
        defaultTab={defaultTab}
      />
    </div>
  );
}
