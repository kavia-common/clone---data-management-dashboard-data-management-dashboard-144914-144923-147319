# Users Created Summary — Manual Test Guide

## Overview

This document describes manual test steps for validating the Users Created Summary feature exposed at GET /api/users/summary. It focuses on tenant scoping behavior (JWT vs x-organization-id), range modes (daily, weekly, monthly, custom), input validation for custom ranges, and expected response structures. Use these steps to verify both backend behavior and the frontend Overview Users Summary chart integration.

## Tenant Scoping

### Priority and conflict rules

- With Authorization (JWT):
  - The effective tenant is taken from the JWT (req.auth.tenantId).
  - Any client-sent tenant hints via header x-organization-id or query organization_id/tenant_id are ignored.
  - If a conflicting tenant is provided in header or query, the server returns 403.

- Without Authorization (JWT):
  - Provide tenant via x-organization-id header. If missing, organization_id or tenant_id query parameter is accepted.
  - If no tenant is resolved, the server returns 400.

- Super Admin bypass:
  - If super admin all-tenants mode is enabled by upstream middleware, tenant may not be required; otherwise, follow the above rules.

### Quick checks

- Expect 403 when JWT tenant conflicts with x-organization-id or query tenant.
- Expect 400 when unauthenticated and no tenant is provided.
- Expect 200 when a valid tenant is provided or enforced by JWT.

## Range Modes and Defaults

- range enum: daily | weekly | monthly | custom (default: daily)
- Default behavior when no range is provided:
  - Daily window for “today” (UTC): start_date and end_date both equal to current UTC date.
- Weekly:
  - The server computes the ISO week window Monday 00:00:00.000Z to Sunday 23:59:59.999Z (UTC).
- Monthly:
  - The server uses the first day of current month at 00:00:00.000Z through current day 23:59:59.999Z (UTC).
- Custom:
  - Requires start_date and end_date in YYYY-MM-DD format.
  - The server validates:
    - Both dates present and match regex ^\d{4}-\d{2}-\d{2}$
    - Date values are valid
    - start_date <= end_date
  - On validation failure, expect 400 with a human-readable message.

## Request Parameters

- organization_id (alias: tenant_id)
- range: daily | weekly | monthly | custom
- start_date: YYYY-MM-DD (required when range=custom)
- end_date: YYYY-MM-DD (required when range=custom)

When Authorization is present, ignore organization_id/tenant_id in requests because the JWT tenant will be enforced and conflicting values cause 403.

## Expected Response

- 200 OK
```json
{
  "buckets": [
    { "key": "2025-01-10", "label": "2025-01-10", "count": 3 }
  ],
  "range": "daily",
  "start_date": "2025-01-10",
  "end_date": "2025-01-10"
}
```

- 400 Bad Request (examples)
```json
{ "message": "Missing tenant. Provide x-organization-id header or ?organization_id=..." }
```
```json
{ "message": "Invalid 'range'. Use daily|weekly|monthly|custom." }
```
```json
{ "message": "For range=custom, 'start_date' and 'end_date' are required in YYYY-MM-DD." }
```
```json
{ "message": "start_date must be before or equal to end_date." }
```

- 403 Forbidden (JWT conflict)
```json
{ "message": "Forbidden: tenant scope mismatch" }
```

## cURL Examples

Replace ORGID with a valid tenant id. Replace BASE with your backend origin (e.g., http://localhost:3001).

- Unauthenticated daily default (today)
```bash
curl -sS -H "x-organization-id: ORGID" "${BASE}/api/users/summary"
```

- Unauthenticated weekly
```bash
curl -sS -H "x-organization-id: ORGID" "${BASE}/api/users/summary?range=weekly"
```

- Unauthenticated monthly
```bash
curl -sS -H "x-organization-id: ORGID" "${BASE}/api/users/summary?range=monthly"
```

- Unauthenticated custom
```bash
curl -sS -H "x-organization-id: ORGID" \
  "${BASE}/api/users/summary?range=custom&start_date=2025-01-01&end_date=2025-01-31"
```

- JWT-scoped daily (header tenant ignored; no conflict)
```bash
curl -sS -H "Authorization: Bearer <JWT>" \
  "${BASE}/api/users/summary?range=daily"
```

- JWT-scoped with conflicting tenant (expect 403)
```bash
curl -i -H "Authorization: Bearer <JWT>" \
  -H "x-organization-id: WRONG_TENANT" \
  "${BASE}/api/users/summary?range=daily"
```

## Manual Test Matrix

1) Unauthenticated happy paths
- Daily default
  - Request: GET /api/users/summary with header x-organization-id: ORGID.
  - Expect 200, range=daily, start_date=end_date=today (UTC), non-negative bucket counts.

- Weekly
  - Request: GET /api/users/summary?range=weekly with header x-organization-id.
  - Expect 200, start_date Monday UTC, end_date Sunday UTC for current week.

- Monthly
  - Request: GET /api/users/summary?range=monthly with header x-organization-id.
  - Expect 200, start_date first day of current month UTC, end_date current day UTC.

- Custom valid dates
  - Request: GET /api/users/summary?range=custom&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD with header x-organization-id.
  - Expect 200, buckets labeled as YYYY-MM-DD (daily buckets within window).

2) Unauthenticated validation failures
- Missing tenant
  - Request: GET /api/users/summary without Authorization and without x-organization-id/organization_id/tenant_id.
  - Expect 400 with message about missing tenant.

- Invalid range
  - Request: GET /api/users/summary?range=hourly with valid x-organization-id.
  - Expect 400 "Invalid 'range'. Use daily|weekly|monthly|custom."

- Custom inputs missing or malformed
  - Missing start_date or end_date, or not in YYYY-MM-DD.
  - start_date > end_date.
  - Expect 400 with appropriate message.

3) JWT-scoped flows
- JWT only
  - Request: GET /api/users/summary with Authorization Bearer JWT only (no tenant params).
  - Expect 200 using JWT tenant.

- JWT with matching tenant hints
  - Add x-organization-id equal to JWT tenant.
  - Expect 200 and normal response.

- JWT with conflicting tenant hints
  - Add x-organization-id or ?organization_id that differs from JWT.
  - Expect 403 Forbidden.

4) Response structure
- Validate top-level fields: buckets (array), range (string), start_date (YYYY-MM-DD), end_date (YYYY-MM-DD).
- Validate each bucket: key (string), label (string), count (integer).
- Ensure count is a number ≥ 0 and label == key for current implementation.

## Frontend Spot Check (Overview -> Users Created)

- Navigate to Overview screen where the Users Created bar chart is rendered.
- Ensure the control allows selecting range: daily, weekly, monthly, custom.
- For custom, ensure the UI sends start_date and end_date in YYYY-MM-DD.
- Verify:
  - Changing range triggers a new request and updates the chart.
  - Total displayed next to title equals the sum of bucket counts.
  - With valid tenant context, the chart loads without error.
  - With an invalid or missing tenant, frontend gracefully handles errors (may render empty state).

## Notes

- All date computations are in UTC. Bucketing keys and labels are formatted using UTC dates.
- The backend matches tenant using multiple possible fields in the users collection: tenant_id, organization_id, organizationId, tenantId, orgId, tenant.tenant_id.
- When using cloud previews, ensure CORS and base URL are configured correctly:
  - Backend: PORT defaults to 3001
  - Frontend: REACT_APP_API_BASE_URL must point to backend origin
- For automated checks in CI, prefer direct backend calls with x-organization-id or JWT, validating HTTP status codes and JSON schema as shown above.
