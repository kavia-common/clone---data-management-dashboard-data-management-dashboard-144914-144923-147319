import { useCallback, useEffect, useMemo, useState } from "react";
import { getUsers } from "../services/usersService";

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

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const { items, total: t } = await getUsers(params, { signal });
      setUsers(items);
      setTotal(t || 0);
    } catch (e) {
      if (e?.name === "AbortError") return;
      setError(e?.message || "Failed to load active users.");
      setUsers([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

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
    refetch: () => load(),
  };
}
