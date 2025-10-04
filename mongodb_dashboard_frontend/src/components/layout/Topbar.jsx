import React from "react";

/**
 * PUBLIC_INTERFACE
 * Topbar
 * Header with brand and user info. No sidebar toggle controls (sidebar is fixed and always visible).
 */
// PUBLIC_INTERFACE
export default function Topbar() {
  /** Top navigation bar with brand mark/wordmark and user chip. */
  return (
    <header className="topbar" role="banner">
      <div className="topbar-left">
        <div className="brand" aria-label="Tenant Dashboard">
          <span className="brand-badge" aria-hidden="true">★</span>
          <span className="brand-title">Tenant Dashboard</span>
        </div>
      </div>

      <div className="topbar-actions" role="group" aria-label="User actions">
        <span className="role-badge" aria-label="Role">Super Admin</span>
        <button
          type="button"
          className="user-chip"
          aria-label="User profile"
          title="User: Guest"
        >
          <span className="user-avatar" aria-hidden="true">G</span>
          <span className="user-name">Guest</span>
        </button>
      </div>
    </header>
  );
}
