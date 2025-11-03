# Sessions by Type time-series

GET /api/analytics/sessions-by-type

- Query: from, to (ISO), granularity=day|week|month, tenant_id
- Defaults: last 30 days, granularity=day
- Uses session_tracking collection
- Timestamp field: last_updated if present, otherwise session_start
- Type derived from: service_type -> type -> session_data.serviceType

Response:
{
  "success": true,
  "items": [
    { "date": "2025-10-01", "series": { "chat": 10, "agent": 2 }, "total": 12 }
  ],
  "meta": { "from": "...", "to": "...", "granularity": "day", "types": ["agent","chat"], "bucketCount": 30 }
}

Logging:
- Warns when no types found for range to aid diagnosing "No data" UI states.
