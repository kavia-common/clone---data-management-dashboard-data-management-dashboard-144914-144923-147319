import { useCallback, useEffect, useMemo, useState } from 'react';
import { getProjectLlmCost, getProjectCostHistorySum, getProjectCost } from '../api/projects';

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
      // 1) Preferred: LLM cost aggregate
      const llm = await getProjectLlmCost(normalizedId);
      const llmCost = Number(llm?.cost);
      if (Number.isFinite(llmCost)) {
        setCost(llmCost);
        setError(null);
        return;
      }
    } catch (e) {
      // swallow and move to next fallback
    }

    try {
      // 2) Fallback: cost-history-sum endpoint (sum of cost_history.delta_total_cost)
      const sum = await getProjectCostHistorySum(normalizedId);
      const sumCost = Number(sum?.cost);
      if (Number.isFinite(sumCost)) {
        setCost(sumCost);
        setError(null);
        return;
      }
    } catch (e) {
      // swallow and move to next fallback
    }

    try {
      // 3) Final fallback: legacy /cost endpoint (sum of total_cost across sessions)
      const legacy = await getProjectCost(normalizedId);
      const legacyCost = Number(legacy?.cost);
      if (Number.isFinite(legacyCost)) {
        setCost(legacyCost);
        setError(null);
        return;
      }
      setCost(null);
      setError('Cost data unavailable');
    } catch (e3) {
      setCost(null);
      setError(e3?.message || 'Failed to load project cost');
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
