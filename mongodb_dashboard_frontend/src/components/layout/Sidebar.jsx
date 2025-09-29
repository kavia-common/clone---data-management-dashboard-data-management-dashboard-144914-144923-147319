import React from "react";
import { NavLink } from "react-router-dom";

// PUBLIC_INTERFACE
export default function Sidebar({ open }) {
  /** Collapsible sidebar with primary navigation links. */
  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
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
