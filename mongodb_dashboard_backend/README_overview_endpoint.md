# Session Tracking Routes Notes

- GET /api/session-tracking → List sessions (supports limit, page, skip, tenant_id/organization_id, sort, q)
  - Returns 200 JSON
  - When page/limit provided, returns { success, data, meta }
  - Minimal headers: X-List-Limit, X-List-Skip, X-Applied-Tenant
- GET /api/session-tracking/aggregate → Aggregated counts over time (moved from root)
- GET /api/session-tracking/raw → Minimal raw document projection for verification
- CORS: preserved via global permissive CORS middleware under /api/*
- ETag: Express default behavior (unchanged)

This preserves backward compatibility for consumers expecting /api/session-tracking as the list endpoint.
