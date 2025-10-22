import React from "react";
import { NavLink } from "react-router-dom";
import "./Sidebar.css";

/**
 * PUBLIC_INTERFACE
 * Sidebar
 * Static, always-open sidebar for primary navigation. No collapse/hide behavior.
 */
// PUBLIC_INTERFACE
export default function Sidebar() {
  /** Always-visible sidebar with main navigation links. */
  return (
    <aside
      id="app-sidebar"
      className="sidebar"
      aria-label="Primary navigation"
      role="navigation"
    >
      <nav aria-label="Main">
        <div className="sidebar-group">Main</div>
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
