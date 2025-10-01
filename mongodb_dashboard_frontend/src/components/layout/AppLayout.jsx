import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import Topbar from "./Topbar";
import Sidebar from "./Sidebar";

/**
 * PUBLIC_INTERFACE
 */
// PUBLIC_INTERFACE
export default function AppLayout({ children }) {
  /**
   * Shell layout with topbar, sidebar, and main content area.
   * Behavior:
   * - Desktop/tablet: sidebar can be collapsed to allow full-width content.
   * - Mobile (<768px): sidebar becomes off-canvas and overlays content with a semi-transparent backdrop.
   * - Clicking outside the sidebar (on the backdrop) closes it (mobile).
   * - Route changes also close the sidebar on mobile for a clean UX.
   */
  const [sidebarOpen, setSidebarOpen] = useState(false); // for mobile off-canvas
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false); // for tablet/desktop collapse
  const sidebarRef = useRef(null);
  const location = useLocation();

  // Close mobile off-canvas sidebar on route change (desktop collapsed state persists)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location]);

  // Track mobile breakpoint consistent with CSS (<768px)
  const isMobile = useIsMobile();

  // Toggle via topbar hamburger:
  // - mobile: open/close the off-canvas
  // - desktop/tablet: collapse/expand the static rail
  const handleToggle = useCallback(() => {
    if (isMobile) {
      setSidebarOpen((o) => !o);
    } else {
      setSidebarCollapsed((c) => !c);
    }
  }, [isMobile]);

  // Close action from inside the sidebar:
  // - mobile: close overlay
  // - desktop/tablet: collapse rail and expand content
  const handleSidebarClose = useCallback(() => {
    if (isMobile) {
      setSidebarOpen(false);
    } else {
      setSidebarCollapsed(true);
    }
  }, [isMobile]);

  // Close on outside click (mobile only) and Esc
  useEffect(() => {
    if (!isMobile || !sidebarOpen) return;
    function onDocClick(e) {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target)) {
        setSidebarOpen(false);
      }
    }
    function onKey(e) {
      if (e.key === "Escape") setSidebarOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [isMobile, sidebarOpen]);

  // For a11y: reflect nav active state appropriately per device
  const navActive = isMobile ? sidebarOpen : !sidebarCollapsed;

  return (
    <div className="app-shell">
      <Topbar onToggleSidebar={handleToggle} sidebarOpen={navActive} />
      <div className={`shell-body ${!isMobile && sidebarCollapsed ? "is-collapsed" : ""}`}>
        {/* Backdrop overlay for mobile only */}
        {isMobile && (
          <div
            className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`}
            onClick={() => setSidebarOpen(false)}
            aria-hidden={!sidebarOpen}
            aria-label="Navigation overlay"
          />
        )}
        <Sidebar
          open={sidebarOpen}
          sidebarRef={sidebarRef}
          onClose={handleSidebarClose}
          collapsed={!isMobile && sidebarCollapsed}
        />
        <main className="content" role="main">
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * Small hook to track mobile breakpoint consistently with CSS (<768px)
 */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)").matches : false
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = (e) => setIsMobile(e.matches);
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else mq.removeListener(handler);
    };
  }, []);
  return isMobile;
}
