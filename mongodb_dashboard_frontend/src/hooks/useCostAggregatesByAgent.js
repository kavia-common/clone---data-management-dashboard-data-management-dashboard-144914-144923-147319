/**
 * PUBLIC_INTERFACE
 * useCostAggregatesByAgent (JS)
 * Returns aggregated cost records for grouped-by-agent visualization.
 * This hook no longer provides mock data; integrate with a real backend endpoint when available.
 *
 * Parameters:
 * - options?: { tenantId?: string; from?: string; to?: string }
 * - groupBy?: "environment" | "cost_category"
 *
 * Returns:
 * - { data: Array<{ agent_name: string; environment?: string; cost_category?: string; total_cost: number }>, loading: boolean, error?: string }
 */
import { useEffect, useState } from "react";

export default function useCostAggregatesByAgent(options, groupBy = "environment") {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        // TODO: Replace with backend aggregate endpoint when available.
        // Example: GET /api/llm-costs/aggregates?dimensions=agent_name,${groupBy}&metrics=SUM(total_cost)
        await Promise.resolve();
        if (!cancelled) {
          setData([]);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || "Failed to load cost aggregates by agent.");
          setData([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [options, groupBy]);

  return { data, loading, error };
}
