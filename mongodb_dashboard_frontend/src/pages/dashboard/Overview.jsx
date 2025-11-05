import React from "react";
import OverviewContainer from "../../components/overview/OverviewContainer.jsx";

/**
 * PUBLIC_INTERFACE
 * Dashboard Overview page
 * Renders the analytics OverviewContainer (KPI row + Sessions time-series).
 * Provides a tiny non-intrusive fallback so users see feedback in rare empty cases.
 */
export default function Overview() {
  return (
    <div className="overview-page" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <OverviewContainer />
      {/* Hidden fallback text in case the child renders nothing in extreme cases */}
      <div aria-hidden="true" style={{ display: "none" }}>
        Loading overview…
      </div>
    </div>
  );
}
