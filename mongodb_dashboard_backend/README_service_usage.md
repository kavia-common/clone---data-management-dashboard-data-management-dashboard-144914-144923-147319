# Service Usage Aggregation (session_tracking.service_type)

Provides counts of sessions grouped by `service_type`, scoped by `tenant_id` and time window.

Endpoint:
GET /api/session-tracking/services

Query params:
- tenant_id (required)
- interval: daily|weekly|monthly|custom (default daily)
- start_date, end_date: ISO or YYYY-MM-DD (UTC). Default last 30 days.
- top: optional integer [1,50] to limit categories
- status: optional regex string for status filtering (e.g., completed|active)
- include_unknown: boolean (default false) to include null/empty service_type
- withTimeBuckets: boolean; when true and interval != custom, returns per time bucket breakdown.

Examples (assuming backend on http://localhost:3001):
- Overall last 30 days with explicit tenant:
  curl -s "http://localhost:3001/api/session-tracking/services?tenant_id=T0015" | jq .

- Explicit date range overall:
  curl -s "http://localhost:3001/api/session-tracking/services?tenant_id=T0015&start_date=2025-11-03&end_date=2025-12-02" | jq .

- Monthly, limited to top 5 categories overall:
  curl -s "http://localhost:3001/api/session-tracking/services?tenant_id=T0015&interval=monthly&start_date=2025-01-01&end_date=2025-12-31&top=5" | jq .

- Weekly time buckets with breakdown:
  curl -s "http://localhost:3001/api/session-tracking/services?tenant_id=T0015&interval=weekly&withTimeBuckets=true" | jq .

Notes:
- Returns 400 when tenant_id is missing or invalid parameters (e.g., top < 1).
- Use header x-debug:true to log pipelines for troubleshooting.
