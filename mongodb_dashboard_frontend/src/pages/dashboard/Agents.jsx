import React from "react";
import AgentsChart from "../../components/charts/AgentsChart";

/**
 * PUBLIC_INTERFACE
 * AgentsDashboardPage
 * Dedicated page to display LLM Cost Distribution by Agent using the AgentsChart component.
 *
 * Notes:
 * - This page composes a single-purpose chart component with built-in data fetching.
 * - The chart includes loading, error (with retry), and empty-state handling.
 */
export default function Agents() {
  return (
    <div>
      <AgentsChart />
    </div>
  );
}
