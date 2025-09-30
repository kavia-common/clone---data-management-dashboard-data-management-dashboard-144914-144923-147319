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
  /** Collapsible and responsive sidebar with primary navigation links only (no extra text/blocks). */
  return (
    <aside
      id="app-sidebar"
      ref={sidebarRef}
      className={`sidebar ${open ? "open" : ""}`}
      aria-label="Primary navigation"
      role="navigation"
    >
      <nav aria-label="Main">
        <NavLink to="/dashboard" end className="nav-link">
          <span className="nav-label">Overview</span>
        </NavLink>
        {/* Only navigation links should appear; remove non-nav group labels or placeholders */}
        <NavLink to="/dashboard/users" className="nav-link">
          <span className="nav-label">Users</span>
        </NavLink>
        <NavLink to="/dashboard/sessions" className="nav-link">
          <span className="nav-label">Session Tracking</span>
        </NavLink>
        <NavLink to="/dashboard/deployments" className="nav-link">
          <span className="nav-label">App Deployments</span>
        </NavLink>
      </nav>
    </aside>
  );
}
