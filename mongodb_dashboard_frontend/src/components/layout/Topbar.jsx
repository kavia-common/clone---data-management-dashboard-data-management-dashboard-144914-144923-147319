import React from "react";
import appLogo from "../../assets/logo/app-logo-2025.png";

/**
 * PUBLIC_INTERFACE
 * Topbar
 * Header with brand and user info. No sidebar toggle controls (sidebar is fixed and always visible).
 */
// PUBLIC_INTERFACE
export default function Topbar() {
  /** Top navigation bar with brand mark/wordmark and user chip. */
  return (
    <header className="topbar app-headbar" role="banner">
      <div className="topbar-left">
        <div className="brand" aria-label="Tenant Dashboard">
          {/* REQ-UI-LOGO-REPLACE: Reuse the same logo asset as Sidebar, placed before the title */}
          <img
            src={appLogo}
            alt="Company logo"
            className="brand-logo"
            style={{ height: 28, width: "auto", marginRight: 8, borderRadius: 8 }}
          />
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
