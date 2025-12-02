import { useCallback, useEffect, useMemo, useState } from "react";
import useUsersData from "./useUsersData";

/**
 * PUBLIC_INTERFACE
 * useActiveUsers
 * Hook to fetch users where status=active with pagination and sorting.
 *
 * Params:
 * - options?: {
 *     page?: number,
 *     limit?: number,
 *     sort?: string // e.g., "-created_at"
 *   }
 *
 * Returns:
 * - {
 *     users: Array<any>,
 *     loading: boolean,
 *     error: string|null,
 *     page: number,
 *     limit: number,
 *     total: number,
 *     sort: string|undefined,
 *     setPage: (n: number) => void,
 *     setLimit: (n: number) => void,
 *     setSort: (s: string) => void,
 *     refetch: () => Promise<void>
 *   }
 */
export default function useActiveUsers(options = {}) {
  const [page, setPage] = useState(options.page || 1);
  const [limit, setLimit] = useState(options.limit || 20);
  const [sort, setSort] = useState(options.sort || "-created_at");

  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const params = useMemo(
    () => ({
      filter: { status: "active" },
      page,
      limit,
      sort,
    }),
    [page, limit, sort]
  );

  // Centralized optimized users fetch (cached, debounced, cancelable)
  const { items: cachedItems, total: cachedTotal, loading: baseLoading, error: baseError, refetch } = useUsersData(params);

  useEffect(() => {
    setUsers(cachedItems || []);
    setTotal(cachedTotal || 0);
    setLoading(baseLoading);
    setError(baseError);
  }, [cachedItems, cachedTotal, baseLoading, baseError]);

  return {
    users,
    loading,
    error,
    page,
    limit,
    total,
    sort,
    setPage,
    setLimit,
    setSort,
    refetch,
  };
}
