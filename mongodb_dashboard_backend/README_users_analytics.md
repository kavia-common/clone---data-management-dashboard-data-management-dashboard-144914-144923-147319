# Users Analytics Docs

This readme documents additive users analytics features added under /api/analytics/users. Existing routes and behaviors remain unchanged.

New endpoints:
- GET /api/analytics/users/activity
  - Query: 
    - granularity=daily|weekly|monthly (default daily)
    - start, end (ISO datetime)
    - role=all|admin|user (default all)
    - department (optional)
    - status (optional; default 'active')
    - organization_id (optional)
  - Response:
    {
      "granularity": "daily",
      "start": "2025-01-01T00:00:00.000Z",
      "end": "2025-01-30T23:59:59.000Z",
      "buckets": [
        { "bucketStart": "2025-01-01T00:00:00.000Z", "total": 42, "admin": 7, "user": 35 }
      ]
    }

- GET /api/analytics/users/summary
  - Query: window=7|30|90 (default 30)
  - Response:
    {
      "window": 30,
      "dau": { "value": 23, "changePct": 12.5 },
      "wau": { "value": 77, "changePct": -3.1 },
      "mau": { "value": 301, "changePct": 2.0 }
    }

Assumptions:
- Active user definition: status === 'active'
- Activity approximation: users.updated_at within bucket range
- Role segmentation: is_admin true => 'admin', false => 'user'

Mount path:
- Router mounted under /api/analytics/users via src/routes/index.js
