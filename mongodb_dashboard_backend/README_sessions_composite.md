# Sessions Composite Endpoint

This backend exposes a composite endpoint to reduce frontend round-trips for the Sessions view.

Endpoint
- GET /api/session-tracking/composite

Accepted query params (mirrors list endpoint)
- tenant_id (alias: organization_id). Required unless super-admin bypass (T0000).
- page, limit (pageSize alias), sort
- q: free-text search across known fields
- start, end: ISO dates (end inclusive end-of-day)
- include_breakdowns=true|false (default true)
- include_series=true|false (default true)

Response shape
{
  "success": true,
  "params": { "tenant_id": "org1", "page": 1, "limit": 20, "sort": "-session_start", "q": "", "start": "...", "end": "...", "include_breakdowns": true, "include_series": true },
  "table": {
    "data": [ ...sessions... ],
    "meta": { "page": 1, "limit": 20, "total": 123, "sort": "-session_start" }
  },
  "aggregates": {
    "totals": { "totalSessions": 123, "active": 10, "completed": 90 },
    "series": { "byType": [ { "type": "Agent", "total": 42 } ], "byOrganization": [ { "organization": "Acme", "total": 21 } ] },
    "breakdowns": {
      "byStatus": [ { "status": "completed", "total": 90 } ],
      "byUser": [ { "user_id": "u1", "total": 12 } ],
      "byTenant": [ { "tenant_id": "org1", "total": 50 } ]
    }
  },
  "generated_at": "ISO",
  "etag": "sha1..."
}

Caching and ETag
- In-memory TTL cache per-process keyed by normalized query+tenant.
- ETag/If-None-Match supported; Cache-Control public, max-age (configurable).
- Env toggles:
  - ENABLE_COMPOSITE_CACHE=true|false (default: true)
  - ENABLE_COMPOSITE_ETAG=true|false (default: true)
  - COMPOSITE_CACHE_TTL_SECONDS=60

Security and scoping
- Reuses existing tenant scoping rules; if JWT is present, the tenant in the token is enforced.
- T0000 super-admin bypass supported consistent with sessions/list.

Notes
- Existing endpoints are unchanged.
- Deterministic ordering consistent with list endpoint (default -session_start).
