import React from "react";
import Card from "../ui/Card.jsx";
import TopAgentsByCostChart from "../costs/TopAgentsByCostChart.jsx";
import { getLlmCostByAgent } from "../../api/client";

/**
 * PUBLIC_INTERFACE
 * AgentsChart
 * Renders the "LLM Cost Distribution by Agent" visualization within a Card.
 *
 * Behavior:
 * - Fetches aggregated costs via GET /api/analytics/llm-cost-by-agent.
 * - Ensures the data is sorted descending (defensive; server already sorts).
 * - Passes data, loading, and error states to the chart component.
 * - Shows an empty-state message when no data is available.
 *
 * Returns:
 * - A card with a bar chart (X=Agent Name, Y=Total Cost in USD).
 * - Tooltip shows exact value with 6 decimal places.
 */
export default function AgentsChart() {
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
        // Defensive: ensure sorted descending by total_cost
        arr.sort((a, b) => Number(b?.total_cost || 0) - Number(a?.total_cost || 0));
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
    <Card
      title="LLM Cost Distribution by Agent"
      subtitle="Summed USD cost per agent (descending). Tooltip shows exact cost to 6 decimals."
      className="mb-4"
    >
      {/* TopAgentsByCostChart handles loading/error/empty rendering */}
      <TopAgentsByCostChart
        data={data.map((d) => ({ agent_name: d.agent, total_cost: d.total_cost }))}
        loading={loading}
        error={error}
        height={360}
      />
    </Card>
  );
}
