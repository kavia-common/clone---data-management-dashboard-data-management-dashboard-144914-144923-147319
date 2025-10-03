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
        <NavLink to="/dashboard" end className="nav-link">
          <span className="nav-label">Overview</span>
        </NavLink>
        <NavLink to="/dashboard/users" className="nav-link">
          <span className="nav-label">Users</span>
        </NavLink>
        <NavLink to="/dashboard/sessions" className="nav-link">
          <span className="nav-label">Session Tracking</span>
        </NavLink>
        <NavLink to="/dashboard/deployments" className="nav-link">
          <span className="nav-label">App Deployments</span>
        </NavLink>
        <NavLink to="/dashboard/costs" className="nav-link">
          <span className="nav-label">Costs</span>
        </NavLink>
      </nav>
    </aside>
  );
}
