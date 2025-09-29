import React, { useState } from "react";
import Topbar from "./Topbar";
import Sidebar from "./Sidebar";

// PUBLIC_INTERFACE
export default function AppLayout({ children }) {
  /** Shell layout with topbar, sidebar, and main content area. */
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="app-shell">
      <Topbar onToggleSidebar={() => setSidebarOpen(o => !o)} />
      <div className="shell-body">
        <Sidebar open={sidebarOpen} />
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
