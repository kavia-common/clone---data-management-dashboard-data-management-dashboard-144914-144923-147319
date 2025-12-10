# Users Summary Manual Tests

Scenarios:
- GET /api/users/summary?organization_id=T0015 (default daily last 30 days)
- GET /api/users/summary?organization_id=T0015&range=weekly (last 12 weeks)
- GET /api/users/summary?organization_id=T0015&range=monthly (last 12 months)
- GET /api/users/summary?organization_id=b2c&range=custom&start_date=2025-11-01&end_date=2025-11-30

Expected:
- HTTP 200
- JSON with buckets: [{ label, count, start, end }], ascending by time.
- start/end represent bucket window in ISO.
- Super admin/global bypass: omit organization_id and expect aggregated across all tenants.

Invalid:
- Missing organization_id for non-admin -> 400
- range=custom without dates -> 400
- range invalid -> 400
