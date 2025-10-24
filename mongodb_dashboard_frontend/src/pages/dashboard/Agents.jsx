import React from "react";
import AgentsChart from "../../components/charts/AgentsChart.jsx";

/**
 * PUBLIC_INTERFACE
 * AgentsDashboardPage
 * Dedicated page to display LLM Cost Distribution by Agent using the AgentsChart component.
 *
 * Notes:
 * - This page intentionally composes a single purpose chart component.
 * - AgentsChart handles data fetching, sorting, and robust loading/error/empty states.
 */
export default function Agents() {
  return (
    <div>
      <AgentsChart />
    </div>
  );
}
