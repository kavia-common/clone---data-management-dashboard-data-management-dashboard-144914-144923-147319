# Analytics Overview Endpoint

- Path: GET /api/analytics/overview
- Query params:
  - range: 7d | 30d | 12w | 12m (default 30d)
  - bucket: daily | weekly | monthly (default daily)

- Response example:
{
  "kpis": { "total": 0, "created": 0, "updated": 0, "deleted": 0 },
  "series": [{ "t": "2025-01-01", "value": 0 }],
  "meta": { "bucket": "daily", "range": "30d" }
}

Notes:
- Falls back to zeroed series if MongoDB is not connected or source collections are missing.
- CORS is enabled globally in src/app.js via security.js corsMiddleware() behavior and permissive fallback.
- Server listens on port 3001 by default (configurable via PORT).
