import { useEffect, useMemo, useState } from 'react';

/**
 * PUBLIC_INTERFACE
 * useProjectCost
 * Fetches aggregated cost for a project from backend (/api/projects/:projectId/cost).
 * Returns { data, loading, error, refetch, formattedCost } where:
 *  - data = { projectId, cost, currency }
 *  - formattedCost = string (e.g., $12.3400), or '—' when not available
 */
export function useProjectCost(projectId, options = {}) {
  // Normalize incoming ID and compute enabled flag
  const normalizedId = useMemo(() => {
    if (projectId == null) return '';
    const id = typeof projectId === 'object' ? (projectId.project_id ?? projectId.projectId ?? projectId.id ?? projectId._id) : projectId;
    if (id == null) return '';
    const s = String(id).trim();
    return s.length > 0 && s !== '—' ? s : '';
  }, [projectId]);

  const enabled = options.enabled ?? Boolean(normalizedId);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState(null);

  // Format function using Intl.NumberFormat for readability
  const formatCurrency = (amount, currency = 'USD') => {
    if (amount == null || Number.isNaN(Number(amount))) return '—';
    try {
      const nf = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || 'USD',
        minimumFractionDigits: 4,
        maximumFractionDigits: 6,
      });
      return nf.format(Number(amount));
    } catch {
      // Fallback if Intl currency code not supported
      const sym = currency === 'USD' ? '$' : '';
      return `${sym}${Number(amount).toFixed(4)}${sym ? '' : ` ${currency || ''}`}`.trim();
    }
  };

  async function fetchCost() {
    if (!enabled || !normalizedId) return;
    setLoading(true);
    setError(null);
    try {
      // Prefer configured API client base if provided; fall back to same-origin /api
      const base =
        process.env.REACT_APP_API_BASE_URL ||
        process.env.REACT_APP_API_URL ||
        '';
      const urlBase = base ? base.replace(/\/+$/, '') : '';
      const res = await fetch(`${urlBase}/api/projects/${encodeURIComponent(normalizedId)}/cost`);
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Failed to load cost (${res.status}): ${txt || res.statusText}`);
      }
      const json = await res.json();
      // Ensure we only keep expected fields
      const payload = {
        projectId: json?.projectId ?? normalizedId,
        cost: Number(json?.cost ?? 0),
        currency: json?.currency || 'USD',
      };
      setData(payload);
    } catch (e) {
      setError(e?.message || 'Failed to load cost');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setData(null);
    setError(null);
    if (enabled && normalizedId) {
      fetchCost();
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedId, enabled]);

  const formattedCost = useMemo(() => {
    if (!data || data.cost == null) return '—';
    return formatCurrency(data.cost, data.currency);
  }, [data]);

  return { data, loading, error, refetch: fetchCost, formattedCost };
}
