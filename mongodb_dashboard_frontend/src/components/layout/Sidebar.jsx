import React from "react";
import { NavLink } from "react-router-dom";

/**
 * PUBLIC_INTERFACE
 * Sidebar
 * Responsive sidebar that:
 * - Desktop: fixed 240px, collapsible to 0 via collapse control
 * - Tablet: compact 72px rail (labels hidden via CSS; can be collapsed to 0)
 * - Mobile: off-canvas with slide-in and overlay when open
 * Includes a close button visible on both desktop (collapse) and mobile (close overlay).
 */
// PUBLIC_INTERFACE
export default function Sidebar({ open, sidebarRef, onClose, collapsed }) {
  /** Collapsible and responsive sidebar with primary navigation links only (no extra text/blocks). */
  return (
    <aside
      id="app-sidebar"
      ref={sidebarRef}
      className={`sidebar ${open ? "open" : ""} ${collapsed ? "collapsed" : ""}`.trim()}
      aria-label="Primary navigation"
      role="navigation"
    >
      {/* Header with close/collapse controls */}
      <div className="sidebar-header" aria-hidden={false}>
        {/* Desktop/tablet collapse button */}
        <button
          type="button"
          className="hamburger sidebar-desktop-close"
          aria-label="Collapse navigation"
          title="Collapse navigation"
          onClick={onClose}
        >
          «
        </button>
        {/* Mobile-only close button */}
        <button
          type="button"
          className="hamburger sidebar-mobile-close"
          aria-label="Close navigation"
          title="Close menu"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <nav aria-label="Main">
        <NavLink
          to="/dashboard"
          end
          className="nav-link"
          title="Overview"
          aria-label="Overview"
        >
          <span className="nav-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" focusable="false">
              <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"></path>
            </svg>
          </span>
          <span className="nav-label">Overview</span>
        </NavLink>

        <NavLink
          to="/dashboard/users"
          className="nav-link"
          title="Users"
          aria-label="Users"
        >
          <span className="nav-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" focusable="false">
              <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V20h8v-1.5C9 14.17 6.33 13 4 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V20h8v-1.5C21 14.17 16.33 13 12 13z"></path>
            </svg>
          </span>
          <span className="nav-label">Users</span>
        </NavLink>

        <NavLink
          to="/dashboard/sessions"
          className="nav-link"
          title="Session Tracking"
          aria-label="Session Tracking"
        >
          <span className="nav-icon" aria-hidden="true">
            <svg width="40" height="20" viewBox="0 0 24 24" fill="currentColor" focusable="false">
              <path d="M19 3h-1V1h-2v2H8V1H6v2H5C3.9 3 3 3.9 3 5v14a2 2 0 002 2h14a2 2 0 002-2V5c0-1.1-.9-2-2-2zm0 16H5V9h14v10zM7 11h5v5H7z"></path>
            </svg>
          </span>
          <span className="nav-label">Session Tracking</span>
        </NavLink>

        <NavLink
          to="/dashboard/deployments"
          className="nav-link"
          title="App Deployments"
          aria-label="App Deployments"
        >
          <span className="nav-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" focusable="false">
              <path d="M4 4h16v2H4zm0 6h10v2H4zm0 6h16v2H4z"></path>
            </svg>
          </span>
          <span className="nav-label">App Deployments</span>
        </NavLink>

        <NavLink
          to="/dashboard/costs"
          className="nav-link"
          title="Costs"
          aria-label="Costs"
        >
          <span className="nav-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" focusable="false">
              <path d="M12 1C9.24 1 7 3.24 7 6h2a3 3 0 016 0c0 2.21-1.79 4-4 4H9v2h2c1.66 0 3 1.34 3 3a3 3 0 11-6 0H6a6 6 0 0012 0c0-2.97-2.17-5.43-5-5.91V9c2.76 0 5-2.24 5-5s-2.24-5-5-5z"></path>
            </svg>
          </span>
          <span className="nav-label">Costs</span>
        </NavLink>
      </nav>
    </aside>
  );
}
