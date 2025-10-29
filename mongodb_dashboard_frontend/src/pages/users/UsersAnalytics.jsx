import React from "react";
import ActiveUsersTrendChart from "../../components/charts/ActiveUsersTrendChart.jsx";
import UsersByTenantBarChart from "../../components/users/UsersByTenantBarChart.jsx";
import TopReferralSourcesBarChart from "../../components/users/TopReferralSourcesBarChart.jsx";

/**
 * PUBLIC_INTERFACE
 * UsersAnalytics
 * Restored simple Users Analytics page rendering core widgets without URL-based global filters.
 */
export default function UsersAnalytics() {
  return (
    <div style={{ display: "grid", gap: 24, padding: 8 }}>
      <ActiveUsersTrendChart />
      <UsersByTenantBarChart />
      <TopReferralSourcesBarChart />
    </div>
  );
}
