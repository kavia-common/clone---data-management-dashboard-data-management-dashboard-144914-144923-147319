import React, { useEffect, useState } from "react";
import "./App.css";
import appLogo from "./assets/logo/app-logo-2025.png"; // REQ-UI-LOGO-REPLACE: shared logo for overlay
import AppRoutes from "./routes/AppRoutes";

/**
 * Internal hook: detect if current viewport width is below the desktop breakpoint (1024px).
 * Listens to window resize and updates reactively.
 */
function useIsBelowDesktopBreakpoint(breakpoint = 1024) {
  const getState = () => {
    if (typeof window === "undefined") return false;
    try {
      return window.innerWidth < breakpoint;
    } catch {
      return false;
    }
  };

  const [isBelow, setIsBelow] = useState(getState);

  useEffect(() => {
    function onResize() {
      setIsBelow(getState());
    }
    window.addEventListener("resize", onResize);
    // initialize once in case the first render occurred before CSS/layout settled
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return isBelow;
}

/**
 * Internal component: blocking overlay for non-desktop viewports.
 * Shows the required copy and prevents the app UI from being accessible.
 */
function DesktopOnlyOverlay() {
  return (
    <div className="device-blocker" role="dialog" aria-modal="true" aria-label="Desktop Only Notice">
      <div className="device-blocker-card">
        <div className="device-blocker-icon">
          {/* REQ-UI-LOGO-REPLACE: replace star icon with shared app logo */}
          <img src={appLogo} alt="App Logo" style={{ height: 24, width: 'auto', display: 'block' }} />
        </div>
        <h1>Desktop Only Application</h1>
        <p>This application requires a desktop environment to function properly.</p>
        <p>Please use a desktop device with a screen width of at least 1024px for the best experience.</p>
        <p className="required"><strong>Required: Desktop Computer</strong></p>
      </div>
    </div>
  );
}

// PUBLIC_INTERFACE
export default function App() {
  /**
   * Root component rendering application routes.
   * Blocks access on viewports narrower than 1024px with a desktop-only overlay.
   * Note: BrowserRouter is provided at the app root (index.js). Do not nest another router here.
   */
  const isBlocked = useIsBelowDesktopBreakpoint(1024);

  if (isBlocked) {
    // Return only the overlay and hide the rest of the app UI
    return <DesktopOnlyOverlay />;
  }

  // Delegate routing to AppRoutes which is rendered under the root BrowserRouter (index.js)
  return <AppRoutes />;
}
