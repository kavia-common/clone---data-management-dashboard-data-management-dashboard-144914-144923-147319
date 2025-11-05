'use strict';

/**
 * PUBLIC_INTERFACE
 * analyticsUsersNewOverTime
 * Returns a standardized 501 Not Implemented response for the "new users over time" analytics
 * service. This preserves the import surface for existing routes/controllers while making it
 * explicit that this endpoint is not implemented yet.
 *
 * TODO: Implement if/when a reliable created_at field and time-bucketing strategy is finalized for users.
 *
 * @param {Object} params - Query params such as granularity, start, end
 * @returns {Object} 501 response payload with a helpful message
 */
module.exports = async function analyticsUsersNewOverTime(params = {}) {
  return {
    success: false,
    status: 501,
    message:
      'Not Implemented: /api/analytics/users/new-over-time is currently disabled. ' +
      'To enable, implement analytics.users.newOverTime.service.js using users.created_at and server-side bucketing.',
    details: {
      granularity: params.granularity || 'day',
      start: params.start || null,
      end: params.end || null,
    },
  };
};
