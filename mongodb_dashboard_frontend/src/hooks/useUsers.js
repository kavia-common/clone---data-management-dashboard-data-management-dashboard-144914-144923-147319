import { useEffect, useMemo, useState } from 'react';
import { listUsers } from '../api'; // unified api index with clients

/**
 * PUBLIC_INTERFACE
 * useUsers
 * A hook to fetch users from the backend and expose loading, error, and data states.
 */
export function useUsers({ page, limit, sort, filter } = {}) {
  /**
   * This is a public function.
   * Returns:
   *  - users: array of user documents (unwrapped if envelope)
   *  - loading: boolean
   *  - error: Error | null
   *  - refetch: function to re-trigger fetch
   */
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const params = useMemo(() => {
    const out = {};
    // Note: limit is intentionally excluded for /api/users (stripped by client rule)
    if (page) out.page = page;
    if (sort) out.sort = sort;
    if (filter) out.filter = typeof filter === 'string' ? filter : JSON.stringify(filter);
    return out;
  }, [page, sort, filter]);

  const fetchUsers = async (signal) => {
    setLoading(true);
    setError(null);
    try {
      // Enforce shared client usage; it appends tenant_id automatically.
      const resp = await listUsers(params, { signal });

      // Development-time verification log to confirm tenant_id is present
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.debug('[useUsers] listUsers(params) invoked with tenant-scoped client. Params:', params);
      }

      // Handle both raw array and envelope formats
      const data = Array.isArray(resp) ? resp : (resp?.data || resp?.items || []);
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setError(err);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchUsers(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(params)]);

  return {
    users,
    loading,
    error,
    refetch: () => fetchUsers(),
  };
}

/**
 * PUBLIC_INTERFACE
 * aggregateUsersByDepartment
 * Aggregates an array of users into counts per department.
 */
export function aggregateUsersByDepartment(users) {
  /** This is a public function.
   * Params:
   *  - users: array of user objects with an optional 'department' field
   * Returns:
   *  - array of { department: string, count: number }
   * Notes:
   *  - Users missing a valid department are excluded (skip undefined, null, empty, or 'Unknown')
   */
  const counts = new Map();

  const isInvalidDept = (val) => {
    if (val == null) return true;
    const s = String(val).trim();
    if (!s) return true;
    return s.toLowerCase() === 'unknown';
  };

  for (const u of users || []) {
    // Try direct and common nested locations
    let dept =
      u?.department ??
      u?.profile?.department ??
      u?.metadata?.department ??
      u?.details?.department;

    // Skip invalid department values
    if (isInvalidDept(dept)) continue;

    const key = String(dept).trim();
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  // Convert to array sorted descending by count
  return Array.from(counts.entries())
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => b.count - a.count);
}
