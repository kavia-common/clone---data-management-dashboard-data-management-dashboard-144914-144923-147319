/**
// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-FE-COSTS-STACKED-003
// User Story: As a user, I want a dedicated costs dashboard section composed of charts.
// Acceptance Criteria: Page exports a React component with a stacked chart example.
// GxP Impact: NO
// Risk: LOW
// ============================================================================
 */

import React from "react";
import CostsStackedBarChart from "../../components/costs/CostsStackedBarChart";
import useCostAggregates from "../../hooks/useCostAggregates";
import Card from "../../components/ui/Card.jsx";

/**
 * PUBLIC_INTERFACE
 * CostsDashboard
 * A dedicated costs dashboard page that showcases the stacked bar chart.
 */
export default function CostsDashboard() {
  const { data, loading, error } = useCostAggregates();
  const [stackBy, setStackBy] = React.useState<"environment" | "cost_category">("environment");

  return (
    <div>
      <Card
        title="Costs Overview"
        subtitle="Service-level cost contributions (stacked)"
      >
        <div className="toolbar" style={{ marginBottom: 8 }}>
          <div className="tabs" role="tablist" aria-label="Stack by selector">
            <button
              role="tab"
              aria-selected={stackBy === "environment"}
              className={`tab ${stackBy === "environment" ? "active" : ""}`}
              onClick={() => setStackBy("environment")}
            >
              Environment
            </button>
            <button
              role="tab"
              aria-selected={stackBy === "cost_category"}
              className={`tab ${stackBy === "cost_category" ? "active" : ""}`}
              onClick={() => setStackBy("cost_category")}
            >
              Cost category
            </button>
          </div>
        </div>

        <CostsStackedBarChart
          records={data}
          stackBy={stackBy}
          loading={loading}
          error={error}
          height={320}
          title="Service Costs (stacked)"
        />
      </Card>
    </div>
  );
}
