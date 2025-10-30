import React from "react";
import Topbar from "./Topbar";
import Sidebar from "./Sidebar";
import PageTransition from "./PageTransition";

/**
 * PUBLIC_INTERFACE
 * AppLayout
 * Shell layout with a fixed, always-visible sidebar and a sticky topbar.
 * - The sidebar is always shown (no collapse/close behavior).
 * - The layout uses CSS grid (see App.css) to allocate a sidebar column and a content column.
 */
// PUBLIC_INTERFACE
export default function AppLayout({ children }) {
  /** Layout wrapper with fixed sidebar and main content. No toggle/close logic is present. */
  return (
    <div className="app-shell">
      <Topbar />
      <div className="shell-body">
        <Sidebar />
        <main className="content" role="main">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
