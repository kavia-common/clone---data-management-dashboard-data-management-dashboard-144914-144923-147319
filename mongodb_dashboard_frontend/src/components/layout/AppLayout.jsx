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
   * - Desktop/tablet: sidebar rail remains visible and does not push content vertically.
   * - Mobile (<768px): sidebar becomes off-canvas and overlays content with a semi-transparent backdrop.
   * - Clicking outside the sidebar (on the backdrop) closes it.
   * - Route changes also close the sidebar on mobile for a clean UX.
   */
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarRef = useRef(null);
  const location = useLocation();

  // Close sidebar on route change (esp. for mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location]);

  // Compute if mobile to decide overlay/backdrop render; keep pure CSS for position
  const isMobile = useIsMobile();

  const handleToggle = useCallback(() => setSidebarOpen((o) => !o), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  // Close on outside click when mobile
  useEffect(() => {
    if (!isMobile || !sidebarOpen) return;
    function onDocClick(e) {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target)) {
        setSidebarOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [isMobile, sidebarOpen]);

  return (
    <div className="app-shell">
      <Topbar onToggleSidebar={handleToggle} />
      <div className="shell-body">
        {/* Backdrop overlay for mobile only, ensures content never shifts */}
        {isMobile && (
          <div
            className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`}
            onClick={closeSidebar}
            aria-hidden={!sidebarOpen}
            aria-label="Navigation overlay"
          />
        )}
        <Sidebar open={sidebarOpen} sidebarRef={sidebarRef} />
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
