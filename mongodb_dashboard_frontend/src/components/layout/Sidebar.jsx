import React from "react";
import { NavLink } from "react-router-dom";

/**
 * PUBLIC_INTERFACE
 * Sidebar
 * Responsive sidebar that:
 * - Desktop: fixed 240px
 * - Tablet: compact 72px rail (labels hidden via CSS)
 * - Mobile: off-canvas with slide-in and overlay when open
 */
// PUBLIC_INTERFACE
export default function Sidebar({ open, sidebarRef }) {
  /** Collapsible and responsive sidebar with primary navigation links. */
  return (
    <aside
      id="app-sidebar"
      ref={sidebarRef}
      className={`sidebar ${open ? "open" : ""}`}
      aria-label="Primary navigation"
      role="navigation"
    >
      <nav>
        <NavLink to="/dashboard" end className="nav-link">Overview</NavLink>
        <div className="sidebar-group">Collections</div>
        <NavLink to="/dashboard/users" className="nav-link">Users</NavLink>
        <NavLink to="/dashboard/sessions" className="nav-link">Session Tracking</NavLink>
        <NavLink to="/dashboard/deployments" className="nav-link">App Deployments</NavLink>
      </nav>
    </aside>
  );
}
