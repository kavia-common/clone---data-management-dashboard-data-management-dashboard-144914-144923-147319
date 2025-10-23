/**
 * PUBLIC_INTERFACE
 * useCostAggregates (JS)
 * Returns aggregated cost records suitable for the stacked chart.
 * If a backend aggregate API is not available, returns a mock dataset for development.
 *
 * Parameters:
 * - options?: { tenantId?: string; from?: string; to?: string }
 *
 * Returns:
 * - { data: Array<{ service_name: string; environment?: string; cost_category?: string; total_cost: number }>, loading: boolean, error?: string }
 */
import { useEffect, useMemo, useState } from "react";

export default function useCostAggregates(options) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const mock = useMemo(
    () => [
      { service_name: "Auth API", environment: "prod", cost_category: "compute", total_cost: 12.34 },
      { service_name: "Auth API", environment: "staging", cost_category: "compute", total_cost: 3.12 },
      { service_name: "Auth API", environment: "prod", cost_category: "storage", total_cost: 1.2 },
      { service_name: "Vectors", environment: "prod", cost_category: "storage", total_cost: 6.9 },
      { service_name: "Vectors", environment: "dev", cost_category: "compute", total_cost: 0.9 },
      { service_name: "Gateway", environment: "prod", cost_category: "egress", total_cost: 4.5 },
    ],
    []
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        // TODO: Replace with backend aggregate endpoint when available.
        // Suggested API: GET /api/llm-costs/aggregates?groupBy=service_name,{environment|cost_category}
        await new Promise((r) => setTimeout(r, 150)); // simulate latency
        if (!cancelled) setData(mock);
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || "Failed to load cost aggregates.");
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
  }, [options, mock]);

  return { data, loading, error };
}
