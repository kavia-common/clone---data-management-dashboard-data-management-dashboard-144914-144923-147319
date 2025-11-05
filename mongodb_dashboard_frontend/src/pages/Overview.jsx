import React from "react";
import OverviewContainer from "../components/overview/OverviewContainer.jsx";

/**
 * PUBLIC_INTERFACE
 * Top-level Overview page (non-namespaced).
 * Renders the shared OverviewContainer so it appears in any Overview route usage.
 */
export default function Overview() {
  return (
    <div className="overview-page" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <OverviewContainer />
      <div aria-hidden="true" style={{ display: "none" }}>
        Loading overview…
      </div>
    </div>
  );
}
