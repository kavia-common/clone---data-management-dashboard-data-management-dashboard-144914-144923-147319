import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import Button from "../ui/Button.jsx";
import "./Sidebar.css";
 // REQ-UI-LOGO-REPLACE: logo removed from sidebar; asset import no longer needed

/**
 * PUBLIC_INTERFACE
 * clearClientAuthArtifacts
 * Utility to clear additional client-side auth/session artifacts beyond the app's primary auth store.
 * Removes common token/user keys from both localStorage and sessionStorage.
 *
 * @param {string[]} [extraKeys] - Optional list of additional keys to clear.
 * @returns {void}
 */
export function clearClientAuthArtifacts(extraKeys = []) {
  /** Clear common auth keys from both localStorage and sessionStorage. */
  const COMMON_KEYS = [
    "authToken",
    "accessToken",
    "refreshToken",
    "user",
    "userInfo",
    "session",
    "sessionId",
    "id_token",
    "token",
    "auth",
    ...extraKeys,
  ];

  try {
    COMMON_KEYS.forEach((k) => {
      try {
        localStorage.removeItem(k);
      } catch {}
      try {
        sessionStorage.removeItem(k);
      } catch {}
    });
  } catch {
    // Swallow errors to avoid blocking logout; nothing critical to do here.
  }
}

/**
 * PUBLIC_INTERFACE
 * Sidebar
 * Static, always-open sidebar for primary navigation with a bottom-aligned Logout control.
 */
export default function Sidebar() {
  /** Always-visible sidebar with main navigation links and a pinned Logout button. */
  const navigate = useNavigate();
  const { logout } = useAuth();

  // PUBLIC_INTERFACE
  function handleLogout() {
    /** Clears auth/session state and navigates to the login page. */
    try {
      // Remove any additional client-side tokens/identifiers
      clearClientAuthArtifacts();

      // Clear primary app auth state via context
      if (typeof logout === "function") {
        logout();
      }
    } catch (e) {
      // Non-fatal; proceed to navigation even if cleanup partially fails
      // eslint-disable-next-line no-console
      console.warn("Logout cleanup encountered an issue:", e);
    } finally {
      // Route to login explicitly
      navigate("/login", { replace: true });
    }
  }

  return (
    <aside
      id="app-sidebar"
      className="sidebar"
      aria-label="Primary navigation"
      role="navigation"
    >
      <div className="sidebar-brand" role="banner" tabIndex="0">
        {/* REQ-UI-LOGO-REPLACE: logo removed intentionally to simplify sidebar branding */}
      </div>
      <div className="sidebar-scroll">
        <nav aria-label="Dashboard sections">
          <NavLink to="/dashboard/overview" end className="nav-link">
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
      </div>

      {/* Bottom pinned area for logout */}
      <div className="sidebar-bottom" aria-label="Account actions">
        <Button
          type="button"
          variant="ghost"
          className="w-full sidebar-logout-btn"
          onClick={handleLogout}
          aria-label="Log out"
          data-testid="logout-button"
        >
          Logout
        </Button>
      </div>
    </aside>
  );
}
