import React from "react";

/**
 * PUBLIC_INTERFACE
 * Topbar
 * Header with responsive controls. Hamburger is always visible but emphasized on mobile.
 */
// PUBLIC_INTERFACE
export default function Topbar({ onToggleSidebar, sidebarOpen }) {
  /** Top navigation bar with brand mark/wordmark and user chip. */
  return (
    <header className="topbar" role="banner">
      <div className="topbar-left">
        <button
          type="button"
          className="hamburger"
          aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
          aria-controls="app-sidebar"
          aria-expanded={!!sidebarOpen}
          onClick={onToggleSidebar}
          title={sidebarOpen ? "Close menu" : "Open menu"}
        >
          {/* Using text icon ensures good contrast without external assets */}
          ☰
        </button>
        <a className="brand" href="/dashboard" aria-label="Go to dashboard home">
          <span className="brand-badge" aria-hidden="true">★</span>
          <span className="brand-title">Kavia Dashboard</span>
        </a>
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
