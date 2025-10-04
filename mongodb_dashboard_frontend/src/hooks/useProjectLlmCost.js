import { useEffect, useMemo, useState } from 'react';
import { getProjectLlmCost } from '../api/projects';

// PUBLIC_INTERFACE
export function useProjectLlmCost(projectId) {
  /** Hook to retrieve LLM cost and provide formatted currency.
   * Returns: { cost, currency, formattedCost, loading, error }
   */
  const [cost, setCost] = useState(0);
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(!!projectId);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!projectId) {
        setLoading(false);
        setCost(0);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await getProjectLlmCost(projectId);
        if (!cancelled) {
          setCost(typeof data?.cost === 'number' ? data.cost : Number(data?.cost || 0));
          setCurrency(data?.currency || 'USD');
        }
      } catch (e) {
        if (!cancelled) {
          setError(e);
          setCost(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const formattedCost = useMemo(() => {
    try {
      const fmt = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency || 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      });
      return fmt.format(cost || 0);
    } catch {
      return `$${(cost || 0).toFixed(2)}`;
    }
  }, [cost, currency]);

  return { cost, currency, formattedCost, loading, error };
}

export default useProjectLlmCost;
