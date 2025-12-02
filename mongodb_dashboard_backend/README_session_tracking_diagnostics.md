# Session Tracking Endpoint Diagnostics

Use these examples to verify the behavior of GET /api/session-tracking and related helper routes.

Prerequisites:
- A running backend with an auth token for a tenant, or use an x-organization-id header to scope when superadmin bypass is not used.

1) Aggregated (daily default), tenant via header with limit
curl -sS -H "Authorization: Bearer YOUR_JWT" \
  -H "x-organization-id: T0015" \
  "http://localhost:8080/api/session-tracking?limit=5"

2) Aggregated weekly with explicit dates and tenant via query
curl -sS -H "Authorization: Bearer YOUR_JWT" \
  "http://localhost:8080/api/session-tracking?interval=weekly&start=2024-10-01&end=2024-11-30&tenant_id=T0015&limit=10"

3) Monthly aggregation with superadmin bypass (T0000)
curl -sS -H "Authorization: Bearer YOUR_SUPERADMIN_JWT" \
  "http://localhost:8080/api/session-tracking?interval=monthly&tenant_id=T0000"

4) Raw windowed fetch for verification
curl -sS -H "Authorization: Bearer YOUR_JWT" \
  -H "x-organization-id: T0015" \
  "http://localhost:8080/api/session-tracking/raw?start=2024-11-01&end=2024-11-30"

5) Simple records list (most recent documents), limit 5
curl -sS -H "Authorization: Bearer YOUR_JWT" \
  -H "x-organization-id: T0015" \
  "http://localhost:8080/api/session-tracking/records?limit=5"

Expected behaviors:
- 200 OK with data for valid scope and inputs.
- 204 No Content when no matching data is found.
- 400 with descriptive error when tenant scope is missing (unless using superadmin bypass) or when invalid dates are supplied for custom interval.
- Response headers include X-Applied-Tenant and helpful diagnostics.
