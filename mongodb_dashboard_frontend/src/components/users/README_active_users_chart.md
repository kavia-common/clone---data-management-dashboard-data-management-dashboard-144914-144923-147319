Active Users filter and chart notes:

- The backend already exposes GET /api/users/active-trend with granularity day|week.
- The UI provides Daily/Weekly/Monthly. Monthly currently falls back to weekly with a small hint for users.
- If monthly aggregation is later added server-side, update:
  - src/components/users/ActiveUsersChart.jsx to map 'monthly' => 'month'
  - src/components/charts/ActiveUsersTrendChart.jsx docstring to include 'month'
  - src/api/usersAnalytics.js getActiveUsersTrend JSDoc
