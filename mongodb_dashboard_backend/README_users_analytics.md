# Users Analytics Endpoints

Canonical paths:
- GET /api/analytics/users/activity-trend
  - Query: from, to, granularity=day|week, status (pipe list), tenant_id (alias organization_id)
  - Returns: { items: [{ date: 'YYYY-MM-DD', total: <int> }], meta: { ... } }

- GET /api/analytics/users/summary
  - Query: to, tenant_id (alias organization_id), status, is_admin, department
  - Returns: { dau, wau, mau, asOf, filters }

Compatibility paths:
- GET /api/users/active-trend (alias of activity-trend)
- GET /api/users/tenant-summary (existing)
- GET /api/analytics/users/tenant-summary (alias that maps controller output)

Backed by:
- session_tracking: uses last_updated or session_start for activity timestamps
- users: created_at/updated_at for segmentation (department, is_admin) and organization_id scoping

Notes:
- All changes are additive and do not alter existing UI.
