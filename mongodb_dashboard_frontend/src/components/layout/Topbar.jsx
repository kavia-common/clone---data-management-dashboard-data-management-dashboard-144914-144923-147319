import React from "react";
import { useAuth } from "../../context/AuthContext";

/**
 * PUBLIC_INTERFACE
 * Topbar - header with brand and user section (shows logout when authenticated)
 */
export default function Topbar() {
  const { isAuthenticated, user, logout } = useAuth();

  return (
    <header className="topbar app-headbar" role="banner">
      <div className="topbar-left">
        <div className="brand" aria-label="Tenant Dashboard">
          <span className="brand-badge" aria-hidden="true">★</span>
          <span className="brand-title">Tenant Dashboard</span>
        </div>
      </div>

      <div className="topbar-actions" role="group" aria-label="User actions" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {isAuthenticated ? (
          <>
            <span className="role-badge" aria-label="Role">Signed in</span>
            <button
              type="button"
              className="user-chip"
              aria-label="User profile"
              title={user?.email || "User"}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                borderRadius: 999,
                border: '1px solid #E5E7EB',
                background: '#fff',
                color: '#111827',
              }}
            >
              <span className="user-avatar" aria-hidden="true" style={{
                width: 22, height: 22, borderRadius: '50%',
                background: '#2563EB', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700
              }}>
                {user?.email ? user.email[0]?.toUpperCase() : 'U'}
              </span>
              <span className="user-name" style={{ fontSize: 13 }}>{user?.email || 'User'}</span>
            </button>
            <button
              onClick={logout}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid #E5E7EB',
                background: '#fff',
                cursor: 'pointer',
                color: '#111827',
              }}
            >
              Logout
            </button>
          </>
        ) : (
          <>
            <span className="role-badge" aria-label="Role">Guest</span>
            <span className="user-name" style={{ fontSize: 13, color: '#6B7280' }}>Please sign in</span>
          </>
        )}
      </div>
    </header>
  );
}
