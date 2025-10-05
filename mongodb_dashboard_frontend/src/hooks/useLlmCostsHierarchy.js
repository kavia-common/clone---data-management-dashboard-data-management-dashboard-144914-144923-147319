import { useEffect, useState } from "react";

// PUBLIC_INTERFACE
export function useLlmCostsHierarchy({ filter } = {}) {
  /** PUBLIC_INTERFACE
   * Fetch hierarchical LLM costs from backend.
   * Returns: { data, loading, error, refetch }
   */
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const buildUrl = () => {
    const base = "/api/llm-costs/hierarchy";
    if (filter) {
      const params = new URLSearchParams();
      params.set("filter", JSON.stringify(filter));
      return `${base}?${params.toString()}`;
    }
    return base;
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl());
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `Request failed with status ${res.status}`);
      }
      const json = await res.json();
      const payload = Array.isArray(json) ? json : json?.data ?? json;
      setData(payload);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filter)]);

  return { data, loading, error, refetch: fetchData };
}

export default useLlmCostsHierarchy;
