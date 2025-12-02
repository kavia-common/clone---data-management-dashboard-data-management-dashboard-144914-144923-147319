# Users API scoping notes

- All list endpoints under /api/users are now strictly scoped by organization on the server.
- Organization is read from trusted locations via middleware (headers preferred): 
  - X-Organization-Id, X-Org-Id, X-Tenant-Id, X-Tenant
  - Fallbacks: query ?tenant_id or ?organization_id, or body.organization_id for POST endpoints.

Verification commands:

- Should return only users for org \"orgA\":
  curl -s 'http://localhost:3001/api/users?limit=5' -H 'X-Organization-Id: orgA' | jq

- Should not be influenced by client-provided filter orgs (server strips and enforces):
  curl -s 'http://localhost:3001/api/users?filter={"tenant_id":"orgB"}' -H 'X-Organization-Id: orgA' | jq

- Debug logs:
  append ?debug=true to see final filter in response meta or header X-Debug-Final-Filter (for unpaginated lists).

## Batch: POST /api/users/projects
Request body:
{
  "userIds": ["u1", "u2"],
  "organization_id": "org_123", // or tenant_id
  "from": "2024-01-01T00:00:00Z",
  "to": "2024-12-31T23:59:59Z"
}

Response:
{
  "success": true,
  "tenant_id": "org_123",
  "data": {
    "u1": [{ "project_id": "p1", "project_name": "Demo", "last_activity": "2024-05-01T10:20:30.000Z" }],
    "u2": []
  },
  "meta": { "requestedUserIds": 2, "from": "...", "to": "..." }
}

Notes:
- Maximum 200 userIds per request.
- Returns empty array for users with no projects in range.
- CORS allowed via environment REACT_APP_FRONTEND_URL or permissive fallback.
