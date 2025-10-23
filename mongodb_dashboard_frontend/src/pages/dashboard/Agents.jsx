import React from "react";
import Card from "../../components/ui/Card.jsx";
import AgentBarChart from "../../components/charts/AgentBarChart.jsx";

/**
// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-FE-AGENT-BAR-CHART-PAGE
// User Story: As a user, I can navigate to a dedicated Agents view to see a bar chart grouped by agent name.
// Acceptance Criteria: Separate page/section, no modification to existing chart pages, responsive, themed.
// GxP Impact: NO (read-only)
// Risk Level: LOW
// ============================================================================

/**
 * PUBLIC_INTERFACE
 * AgentsDashboardPage
 * Dedicated page to display bar chart grouped by agent name.
 *
 * Notes:
 * - This page intentionally does not alter existing charts; it's a standalone view.
 * - Uses Ocean Professional theme via shared UI components.
 */
export default function Agents() {
  return (
    <div>
      <Card
        title="Agents"
        subtitle="Bar chart grouped by agent name. Use the controls to change metric and limit."
        className="mb-4"
      >
        <AgentBarChart defaultMetric="count" defaultTopN={10} height={360} />
      </Card>

      <Card title="Usage Notes" subtitle="About this visualization">
        <ul style={{ margin: "0.5rem 1rem" }}>
          <li>Metric selector switches between record count and total cost per agent.</li>
          <li>Top N limits the number of agents displayed (1 to 50).</li>
          <li>
            Data is fetched from the backend LLM costs endpoint and aggregated on the client. No
            backend modifications were required.
          </li>
        </ul>
      </Card>
    </div>
  );
}
