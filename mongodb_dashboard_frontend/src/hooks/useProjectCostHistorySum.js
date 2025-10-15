import { useCallback, useEffect, useMemo, useState } from 'react';
import { getProjectCostHistorySum, getProjectCost } from '../api/projects';

/**
 * PUBLIC_INTERFACE
 * useProjectCostHistorySum
 * Hook to fetch summed project cost from GET /api/projects/:projectId/cost-history-sum.
 * Falls back to GET /api/projects/:projectId/cost when sum is unavailable or fails.
 *
 * Returns:
 *  - cost: number|null
 *  - formattedCost: string (USD formatted with 4-6 fraction digits)
 *  - loading: boolean
 *  - error: string|null
 *  - refetch: () => Promise<void>
 *
 * Notes:
 *  - Prefers sum of cost_history.delta_total_cost since it reflects incremental cost updates
 *    and supersedes naive summation of total_cost fields on sessions.
 */
export function useProjectCostHistorySum(projectId, options = {}) {
  // Normalize incoming projectId
  const normalizedId = useMemo(() => {
    if (projectId == null) return '';
    // Support passing an object with possible keys
    const id =
      typeof projectId === 'object'
        ? (projectId.project_id ??
           projectId.projectId ??
           projectId.id ??
           projectId._id)
        : projectId;
    if (id == null) return '';
    const s = String(id).trim();
    return s.length > 0 && s !== '—' ? s : '';
  }, [projectId]);

  const enabled = options.enabled ?? Boolean(normalizedId);

  const [cost, setCost] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState(null);

  // Currency formatter (USD) per instructions
  const formatter = useMemo(() => {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 4,
        maximumFractionDigits: 6,
      });
    } catch {
      return null;
    }
  }, []);

  const formattedCost = useMemo(() => {
    if (cost == null || Number.isNaN(Number(cost))) return '—';
    if (formatter) return formatter.format(Number(cost));
    // Fallback formatting
    return `$${Number(cost).toFixed(4)}`;
  }, [cost, formatter]);

  const refetch = useCallback(async () => {
    if (!enabled || !normalizedId) return;
    setLoading(true);
    setError(null);
    try {
      // First try the cost-history-sum endpoint (sum of cost_history.delta_total_cost)
      const sum = await getProjectCostHistorySum(normalizedId);
      if (process.env.NODE_ENV !== 'production') {
        try { console.log('[useProjectCostHistorySum] /cost-history-sum response:', sum); } catch {}
      }
      // If endpoint returns a numeric cost, use it. If null/undefined or NaN, try fallback.
      const sumCost = Number(sum?.cost);
      if (Number.isFinite(sumCost)) {
        setCost(sumCost);
        setError(null);
      } else {
        // Fallback: legacy /cost endpoint (sum of total_cost across sessions)
        const legacy = await getProjectCost(normalizedId);
        if (process.env.NODE_ENV !== 'production') {
          try { console.log('[useProjectCostHistorySum] fallback /cost response:', legacy); } catch {}
        }
        const legacyCost = Number(legacy?.cost);
        setCost(Number.isFinite(legacyCost) ? legacyCost : null);
        if (!Number.isFinite(legacyCost)) {
          setError('Cost data unavailable');
        }
      }
    } catch (e) {
      // If sum endpoint fails, try legacy as fallback
      try {
        const legacy = await getProjectCost(normalizedId);
        if (process.env.NODE_ENV !== 'production') {
          try { console.log('[useProjectCostHistorySum] catch fallback /cost response:', legacy); } catch {}
        }
        const legacyCost = Number(legacy?.cost);
        setCost(Number.isFinite(legacyCost) ? legacyCost : null);
        if (!Number.isFinite(legacyCost)) {
          setError(e?.message || 'Failed to load project cost');
        }
      } catch (e2) {
        setCost(null);
        setError(e2?.message || e?.message || 'Failed to load project cost');
      }
    } finally {
      setLoading(false);
    }
  }, [enabled, normalizedId]);

  useEffect(() => {
    setCost(null);
    setError(null);
    if (enabled && normalizedId) {
      refetch();
    } else {
      setLoading(false);
    }
  }, [enabled, normalizedId, refetch]);

  return { cost, formattedCost, loading, error, refetch };
}
