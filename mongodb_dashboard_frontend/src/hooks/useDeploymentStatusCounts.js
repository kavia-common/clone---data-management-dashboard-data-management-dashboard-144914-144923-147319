/**
// ============================================================================
// Dynamic Deployment Status Counts Hook
// ============================================================================
// Requirement: Make the "Deployments by Status" chart dynamic to include all
// statuses present in the database. Remove hard-coded arrays of statuses.
// Provide { data, loading, error } and be resilient to empty data.
// ============================================================================
*/
import { useEffect, useMemo, useState } from "react";
import { fetchDeploymentStatusCounts } from "../api/deployments";

/**
 * PUBLIC_INTERFACE
 * useDeploymentStatusCounts
 * Hook that returns deployment status counts dynamically.
 *
 * Parameters:
 * - options?: {
 *     preferServer?: boolean; // when true, attempts GET /api/app-deployments/status-counts before falling back
 *     pageLimit?: number;     // client-side aggregation: number per page (default 200)
 *     maxPages?: number;      // client-side aggregation: max pages to fetch (default 5)
 *   }
 *
 * Returns:
 * - { data: Array<{ status: string, count: number }>, loading: boolean, error: string }
 *
 * Behavior:
 * - Calls fetchDeploymentStatusCounts with provided options.
 * - Sorts by count desc then status asc.
 * - Gracefully handles empty or missing statuses; labels unknown as "Unknown".
 */
export function useDeploymentStatusCounts(options = {}) {
  const {
    preferServer = false,
    pageLimit = 200,
    maxPages = 5,
  } = options;

  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function run() {
      setLoading(true);
      setError("");
      try {
        const items = await fetchDeploymentStatusCounts({ preferServer, pageLimit, maxPages });
        if (mounted) {
          const sorted = Array.isArray(items)
            ? items
                .map((d) => ({ status: String(d?.status ?? "Unknown"), count: Number(d?.count || 0) }))
                .sort((a, b) => (b.count - a.count) || a.status.localeCompare(b.status))
            : [];
          setData(sorted);
        }
      } catch (e) {
        if (mounted) {
          setError(e?.response?.data?.message || e?.message || "Failed to load deployment status counts.");
          setData([]);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    run();
    return () => {
      mounted = false;
    };
  }, [preferServer, pageLimit, maxPages]);

  const validated = useMemo(() => {
    // Ensure data shape and types
    return (Array.isArray(data) ? data : []).map((d) => ({
      status: String(d?.status ?? "Unknown"),
      count: Number(d?.count || 0),
    }));
  }, [data]);

  return { data: validated, loading, error };
}

export default useDeploymentStatusCounts;
