/**
 * PUBLIC_INTERFACE
 * useCostAggregates (JS)
 * Returns aggregated cost records suitable for the stacked chart.
 * This hook now relies solely on real APIs when available and does not include any mock dataset.
 *
 * Parameters:
 * - options?: { tenantId?: string; from?: string; to?: string }
 *
 * Returns:
 * - { data: Array<{ service_name: string; environment?: string; cost_category?: string; total_cost: number }>, loading: boolean, error?: string }
 */
import { useEffect, useState } from "react";

export default function useCostAggregates(options) {
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
        // Suggested API: GET /api/llm-costs/aggregates?groupBy=service_name,{environment|cost_category}
        // For now, we return an empty dataset gracefully.
        await Promise.resolve();
        if (!cancelled) setData([]);
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
  }, [options]);

  return { data, loading, error };
}
