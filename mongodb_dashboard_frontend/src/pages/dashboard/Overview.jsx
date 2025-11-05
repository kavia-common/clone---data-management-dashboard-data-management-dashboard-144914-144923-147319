import React from "react";
import OverviewContainer from "../../components/overview/OverviewContainer.jsx";

// PUBLIC_INTERFACE
export default function Overview() {
  /**
   * Overview page using the new OverviewContainer which includes:
   * - KPI cards via backend /api/analytics/overview
   * - Time-series chart with toggleable moving average
   * - Range selector (7d/30d/12w/12m)
   * Styling adheres to Ocean Professional theme.
   */
  return (
    <div className="grid">
      <OverviewContainer />
    </div>
  );
}
