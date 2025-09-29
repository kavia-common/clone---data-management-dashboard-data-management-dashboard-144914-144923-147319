import React from "react";

// PUBLIC_INTERFACE
export default function Topbar({ onToggleSidebar }) {
  /** Top navigation bar with app title and passive user chip (no auth logic). */
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="hamburger" onClick={onToggleSidebar} aria-label="Toggle navigation">☰</button>
        <div className="brand">
          <span className="brand-badge">◎</span>
          <span className="brand-title">Ocean Dashboard</span>
        </div>
      </div>
      <div className="topbar-actions">
        <div className="user-chip" aria-label="User">
          <span className="user-avatar">G</span>
          <span className="user-name">Guest</span>
        </div>
      </div>
    </header>
  );
}
