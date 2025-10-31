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
    if (page) out.page = page;
    if (limit) out.limit = limit;
    if (sort) out.sort = sort;
    if (filter) out.filter = typeof filter === 'string' ? filter : JSON.stringify(filter);
    return out;
  }, [page, limit, sort, filter]);

  const fetchUsers = async (signal) => {
    setLoading(true);
    setError(null);
    try {
      // Prefer existing users API client if present; fallback to generic api util
      let resp;
      if (typeof listUsers === 'function') {
        resp = await listUsers(params, { signal });
      } else {
        // Generic fetch
        const qs = new URLSearchParams(params).toString();
        const res = await fetch(`/api/users${qs ? `?${qs}` : ''}`, { signal });
        if (!res.ok) throw new Error(`Failed to fetch users: ${res.status}`);
        resp = await res.json();
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
   *  - Users missing department are grouped under 'Unknown'
   */
  const counts = new Map();
  for (const u of users || []) {
    // Normalize department
    let dept = u?.department;
    if (dept == null || (typeof dept === 'string' && dept.trim() === '')) {
      dept = 'Unknown';
    }
    // Some schemas may nest department info; attempt a few common paths
    if (dept === 'Unknown') {
      const nested = u?.profile?.department || u?.metadata?.department;
      if (nested && String(nested).trim()) {
        dept = String(nested).trim();
      }
    }
    const key = String(dept);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  // Convert to array sorted descending by count
  return Array.from(counts.entries())
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => b.count - a.count);
}
