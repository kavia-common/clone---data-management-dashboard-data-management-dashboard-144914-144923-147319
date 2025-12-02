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

