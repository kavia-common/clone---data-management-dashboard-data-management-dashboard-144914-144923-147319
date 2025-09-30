import React from "react";

// PUBLIC_INTERFACE
export default function Topbar({ onToggleSidebar }) {
  /** Top navigation bar with brand mark/wordmark and user chip. */
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="hamburger" onClick={onToggleSidebar} aria-label="Toggle navigation">☰</button>
        <div className="brand">
          <span className="brand-badge">★</span>
          <span className="brand-title">Kavia Dashboard</span>
        </div>
      </div>
      <div className="topbar-actions">
        <span className="role-badge" aria-label="Role">Super Admin</span>
        <div className="user-chip" aria-label="User">
          <span className="user-avatar">G</span>
          <span className="user-name">Guest</span>
        </div>
      </div>
    </header>
  );
}
