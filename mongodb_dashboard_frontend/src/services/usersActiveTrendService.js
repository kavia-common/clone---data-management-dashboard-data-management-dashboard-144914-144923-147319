import { getActiveUsersTrend } from '../api/usersActiveTrend';

/**
 * PUBLIC_INTERFACE
 * usersServiceActiveTrend.getActiveTrend
 * Service layer for fetching active users over time. Returns { items, meta }.
 * Legacy aggregation (day/week) parameters are ignored.
 */
const usersServiceActiveTrend = {
  getActiveTrend: async ({ from, to, tenantId, status } = {}) => {
    return getActiveUsersTrend({ from, to, tenantId, status });
  },
};

export default usersServiceActiveTrend;
