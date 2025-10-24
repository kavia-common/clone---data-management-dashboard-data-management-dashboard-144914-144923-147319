import React from "react";
import Card from "../../components/ui/Card.jsx";
import TopAgentsByCostChart from "../../components/costs/TopAgentsByCostChart.jsx";
import { getLlmCostByAgent } from "../../api/client";

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
  const [data, setData] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const items = await getLlmCostByAgent();
        if (!mounted) return;
        const arr = Array.isArray(items) ? items : [];
        setData(arr);
      } catch (e) {
        if (!mounted) return;
        setError(e?.message || "Failed to load LLM cost distribution by agent.");
        setData([]);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div>
      <Card
        title="LLM Cost Distribution by Agent"
        subtitle="Summed USD cost per agent (descending). Tooltip shows exact cost to 6 decimals."
        className="mb-4"
      >
        <TopAgentsByCostChart data={data.map(d => ({ agent_name: d.agent, total_cost: d.total_cost }))} loading={loading} error={error} height={360} />
      </Card>
    </div>
  );
}
