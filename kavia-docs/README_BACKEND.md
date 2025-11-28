# Backend Dev Notes

- Dev server runs on port 3001.
- Do not start CRA or any React dev server from the backend. The frontend runs independently on port 3000.
- Frontend uses CRA proxy to forward API requests from 3000 to backend 3001 in development.

## Verification (Real-time Data)

Tenant-wise Users Summary endpoint

The backend exposes an aggregation endpoint to compute distinct active users per tenant, primarily from the session_tracking collection. It powers the Users by Tenant bar chart in the frontend.

Method: GET  
Path: /api/users/tenant-summary  
Description: Aggregates distinct users per tenant within an optional time range and session status filter. When includeInactive=true is passed, the endpoint falls back to the users and tenants collections to include tenants with no recent activity in the specified window.

Query parameters:
- from (string, ISO date-time, optional): Lower bound of the time range filter. Example: 2024-09-01T00:00:00.000Z
- to (string, ISO date-time, optional): Upper bound of the time range filter. Example: 2024-10-01T00:00:00.000Z
- status (string, optional): Session status filter. Default "completed|active".
- includeInactive (boolean, optional, default false): When true, includes tenants from tenants/users collections even if they have no activity in the given period.

Response:

200 OK with:
{
  "items": [
    { "tenant_id": "org1", "tenant_name": "Organization One", "user_count": 12 },
    { "tenant_id": "org2", "tenant_name": "Organization Two", "user_count": 5 }
  ],
  "total": 2
}

Notes and caching:
- Results are computed via MongoDB aggregations against session_tracking and optionally joined metadata for tenant names.
- The service may employ in-memory caching with a TTL to improve performance under repeated queries with identical parameters. Cache is per-process and non-persistent.
- If includeInactive=true, the query may additionally read from users and tenants collections to ensure tenants with zero recent activity appear with user_count possibly being 0.
- Exact details of the underlying aggregation may evolve as schema evolves; consult routes/users.routes.js and services/users.service.js for implementation.
- OpenAPI: See /openapi.json for details.
