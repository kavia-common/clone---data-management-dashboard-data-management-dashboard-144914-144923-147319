import React from "react";
import { NavLink } from "react-router-dom";

/**
 * PUBLIC_INTERFACE
 * Sidebar
 * Slim icon-rail sidebar matching the reference design:
 * - 72px width rail on desktop/tablet with icon-only items.
 * - 44px item height, 20px icon size, 8px gaps.
 * - Hover background, active state with 3px orange left indicator, and darker icon.
 * - Tooltips on hover/focus in desktop/tablet; on mobile overlay labels are shown inline.
 * - Mobile (<768px): off-canvas drawer shows labels and left-aligned icons; overlay closes on click/escape.
 */
// PUBLIC_INTERFACE
export default function Sidebar({ open, sidebarRef, onClose, collapsed }) {
  /** Slim, icon-rail sidebar with primary navigation and a footer group. */
  return (
    <aside
      id="app-sidebar"
      ref={sidebarRef}
      className={`sidebar sidebar--slim ${open ? "open" : ""} ${collapsed ? "collapsed" : ""}`.trim()}
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
        {/* Primary group */}
        <div className="nav-group">
          <NavLink
            to="/dashboard"
            end
            aria-label="Overview"
            title="Overview"
            data-tooltip="Overview"
            className={({ isActive }) => `sidebar-item ${isActive ? "is-active" : ""}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              {/* Home icon */}
              <path d="M3 11.5L12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-8.5z" />
            </svg>
            <span className="nav-label">Overview</span>
          </NavLink>

          <NavLink
            to="/dashboard/users"
            aria-label="Users"
            title="Users"
            data-tooltip="Users"
            className={({ isActive }) => `sidebar-item ${isActive ? "is-active" : ""}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              {/* Users icon */}
              <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span className="nav-label">Users</span>
          </NavLink>

          <NavLink
            to="/dashboard/sessions"
            aria-label="Sessions"
            title="Sessions"
            data-tooltip="Sessions"
            className={({ isActive }) => `sidebar-item ${isActive ? "is-active" : ""}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              {/* Clock icon */}
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 3" />
            </svg>
            <span className="nav-label">Sessions</span>
          </NavLink>

          <NavLink
            to="/dashboard/deployments"
            aria-label="Deployments"
            title="Deployments"
            data-tooltip="Deployments"
            className={({ isActive }) => `sidebar-item ${isActive ? "is-active" : ""}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              {/* Rocket icon */}
              <path d="M4.5 16.5l3-3M9 21s1.5-4.5 6-9 9-6 9-6-1.5 6-6 10.5S9 21 9 21z" transform="translate(-3 -3) scale(0.75)" />
              <circle cx="12" cy="10" r="2" />
            </svg>
            <span className="nav-label">Deployments</span>
          </NavLink>

          <NavLink
            to="/dashboard/costs"
            aria-label="Costs"
            title="Costs"
            data-tooltip="Costs"
            className={({ isActive }) => `sidebar-item ${isActive ? "is-active" : ""}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              {/* Chart/Dollar icon */}
              <path d="M3 3v18h18" />
              <path d="M7 15l4-4 3 3 5-7" />
            </svg>
            <span className="nav-label">Costs</span>
          </NavLink>
        </div>

        {/* Footer group */}
        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-item"
            aria-label="Settings"
            title="Settings"
            data-tooltip="Settings"
            onClick={onClose}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              {/* Gear icon */}
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 4.4l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.08a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .67.39 1.27 1 1.51.33.14.69.21 1.05.21H21a2 2 0 1 1 0 4h-.09a1.98 1.98 0 0 1-1.51.28z" />
            </svg>
            <span className="nav-label">Settings</span>
          </button>
          <button
            type="button"
            className="sidebar-item"
            aria-label="Logout"
            title="Logout"
            data-tooltip="Logout"
            onClick={onClose}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              {/* Power icon */}
              <path d="M12 2v10" />
              <path d="M5.5 5.5a7.5 7.5 0 1 0 13 0" />
            </svg>
            <span className="nav-label">Logout</span>
          </button>
        </div>
      </nav>
    </aside>
  );
}
