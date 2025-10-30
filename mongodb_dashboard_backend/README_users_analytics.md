# Users Tenant Summary

Endpoint
- GET /api/users/tenant-summary
- Query params:
  - from: ISO datetime (inclusive)
  - to: ISO datetime (inclusive)
  - status: pipe-delimited values, e.g. active|completed
  - includeInactive: boolean (default false)

Response
- 200: Array of items shaped as { tenant: string, count: number }
  Example:
  [
    { "tenant": "Org One", "count": 12 },
    { "tenant": "Org Two", "count": 7 }
  ]

Notes
- The route is mounted via src/routes/users.analytics.summary.routes.js under app.js with app.use('/api/users', ...).
- Only one handler responds at GET /api/users/tenant-summary; temporary debug routes have been removed.

