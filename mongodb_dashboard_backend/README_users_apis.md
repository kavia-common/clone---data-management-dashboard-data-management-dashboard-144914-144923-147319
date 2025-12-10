# Users API scoping notes

- All list endpoints under /api/users are now strictly scoped by organization on the server.
- Organization is read from trusted locations via middleware (headers preferred): 
  - X-Organization-Id, X-Org-Id, X-Tenant-Id, X-Tenant
  - Fallbacks: query ?tenant_id or ?organization_id, or body.organization_id for POST endpoints.

Verification commands:

- Should return only users for org "orgA":
  curl -s 'http://localhost:3001/api/users?limit=5' -H 'X-Organization-Id: orgA' | jq

- Should not be influenced by client-provided filter orgs (server strips and enforces):
  curl -s 'http://localhost:3001/api/users?filter={"tenant_id":"orgB"}' -H 'X-Organization-Id: orgA' | jq

- Debug logs:
  append ?debug=true to see final filter in response meta or header X-Debug-Final-Filter (for unpaginated lists).


## Users created summary (time buckets)

GET /api/users/summary

Parameters:
- organization_id (alias tenant_id): required unless super-admin bypass is active
- range: daily|weekly|monthly|custom (default: daily)
- start_date, end_date: YYYY-MM-DD (required when range=custom)

Behavior:
- Aggregates users by created_at using $dateTrunc in UTC when available.
- Pipeline stages:
  - $match (tenant scope via organization_id/tenant_id and created_at range)
  - $set { _bucketStart: $dateTrunc($created_at, unit: day|week|month, timezone: 'UTC') }
  - $group by _bucketStart to count documents
  - $sort ascending by _id
  - $project final fields as { label, count, start, end } (no reserved or invalid identifiers)
- start_date/end_date are ignored unless range=custom; header x-users-summary-note is set when ignored.
- Output timezones: all buckets and labels use UTC.

Examples:
- Daily default:
  curl -s "http://localhost:3001/api/users/summary?organization_id=b2c&range=daily" | jq
- Weekly:
  curl -s "http://localhost:3001/api/users/summary?organization_id=b2c&range=weekly" | jq
- Monthly:
  curl -s "http://localhost:3001/api/users/summary?organization_id=b2c&range=monthly" | jq
- Custom:
  curl -s "http://localhost:3001/api/users/summary?organization_id=b2c&range=custom&start_date=2025-01-01&end_date=2025-01-31" | jq

Output shape:
{
  "buckets": [
    { "label": "2025-01-01", "count": 3, "start": "2025-01-01T00:00:00.000Z", "end": "2025-01-01T23:59:59.999Z" }
  ],
  "range": "daily",
  "start_date": "2025-01-01",
  "end_date": "2025-01-31"
}
