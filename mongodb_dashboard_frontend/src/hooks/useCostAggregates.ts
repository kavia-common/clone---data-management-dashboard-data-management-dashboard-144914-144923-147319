/**
// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-FE-COSTS-STACKED-002
// User Story: As a developer, I need a hook to supply aggregated cost data to charts.
// Acceptance Criteria:
// - Hook returns { data, loading, error } for cost aggregates grouped by service and environment/category
// - Includes TODO for backend API when available; provides mock fallback
// GxP Impact: NO
// Risk: LOW
// ============================================================================
 */

import { useEffect, useMemo, useState } from "react";
import type { CostRecord } from "../utils/costs/shapeStackedSeries";

/**
 * PUBLIC_INTERFACE
 * useCostAggregates
 * Returns aggregated cost records suitable for the stacked chart.
 * If a backend aggregate API is not available, returns a mock dataset for development.
 *
 * Parameters:
 * - options?: { tenantId?: string; from?: string; to?: string }
 *
 * Returns:
 * - { data: CostRecord[], loading: boolean, error?: string }
 */
export default function useCostAggregates(options?: {
  tenantId?: string;
  from?: string;
  to?: string;
}) {
  const [data, setData] = useState<CostRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const mock: CostRecord[] = useMemo(
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
        // As a fallback, we attempt to fetch /api/llm-costs and aggregate client-side (if fields exist).
        // For now, provide mock data to unblock UI development.
        await new Promise((r) => setTimeout(r, 150)); // simulate latency
        if (!cancelled) setData(mock);
      } catch (e: any) {
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
