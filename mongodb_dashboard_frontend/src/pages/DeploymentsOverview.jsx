/**
 * PUBLIC_INTERFACE
 * DeploymentsOverview
 * Page-level container rendering the DeploymentStatusBarChart with the hook.
 * This component can be routed or embedded within existing dashboard pages.
 */
import React from "react";
import DeploymentStatusBarChart from "../components/charts/DeploymentStatusBarChart.jsx";
import useDeploymentStatusCounts from "../hooks/useDeploymentStatusCounts";

export default function DeploymentsOverview() {
  const { data, loading, error } = useDeploymentStatusCounts({
    // Switch to 'clientAggregate' to compute from recent deployments,
    // or set useServer: true once /api/app-deployments/status-counts exists.
    strategy: "clientAggregate",
    useServer: false,
    pageLimit: 200,
    maxPages: 5,
  });

  return (
    <div className="grid">
      <DeploymentStatusBarChart
        title="Project Details"
        subtitle="Deployments by Status"
        data={data}
        loading={loading}
        error={error}
        height={320}
      />
    </div>
  );
}
