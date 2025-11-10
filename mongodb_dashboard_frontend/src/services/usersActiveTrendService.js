import { getActiveUsersTrend } from '../api/usersActiveTrend';

/**
 * PUBLIC_INTERFACE
 * usersServiceActiveTrend.getActiveTrend
 * Service layer for fetching active users trend. Returns { items, meta }.
 */
const usersServiceActiveTrend = {
  getActiveTrend: async ({ from, to, granularity = 'day', tenantId, status } = {}) => {
    return getActiveUsersTrend({ from, to, granularity, tenantId, status });
  },
};

export default usersServiceActiveTrend;
