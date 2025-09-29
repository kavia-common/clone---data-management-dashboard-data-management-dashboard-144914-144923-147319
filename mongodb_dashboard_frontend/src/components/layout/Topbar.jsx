import React from "react";
import Button from "../ui/Button";
import { useAuth } from "../../auth/AuthContext";

// PUBLIC_INTERFACE
export default function Topbar({ onToggleSidebar }) {
  /** Top navigation bar with app title and user actions. */
  const { user, logout } = useAuth();

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
        <div className="user-chip">
          <span className="user-avatar">{(user?.name || user?.email || "U").slice(0,1).toUpperCase()}</span>
          <span className="user-name">{user?.name || user?.email || "User"}</span>
        </div>
        <Button variant="secondary" onClick={logout}>Logout</Button>
      </div>
    </header>
  );
}
