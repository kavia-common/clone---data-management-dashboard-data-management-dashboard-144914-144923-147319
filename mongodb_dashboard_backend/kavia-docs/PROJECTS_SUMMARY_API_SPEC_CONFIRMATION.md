# Projects Summary API Spec Confirmation

## Overview
This note confirms that the OpenAPI contract for GET /api/projects/summary in interfaces/openapi.json is aligned with the actual implementation at src/routes/projects.summary.routes.js.

## Endpoint
- Method and path: GET /api/projects/summary
- Purpose: Aggregates project counts grouped by created_at with time bucketing and tenant scoping.

## Tenant Scoping
- Primary scope comes from auth context when present (req.organizationId or req.tenantId set by middleware).
- When not authenticated, the request may provide:
  - Header: x-organization-id
  - Query aliases: organization_id or tenant_id
- Super/admin bypass (req.tenantScopeDisabled or req.allTenants) allows global scope (no tenant filter).
- Implementation sets the x-effective-tenant response header when a tenant is resolved.

## Parameters
- range: string enum daily|weekly|monthly|custom (default daily)
- start_date: string YYYY-MM-DD (required when range=custom)
- end_date: string YYYY-MM-DD (required when range=custom)
- Tenant aliases:
  - Header: x-organization-id (ignored if JWT tenant is present or super admin)
  - Query: organization_id (alias)
  - Query: tenant_id (alias)

## Behavior and Windowing
- daily: today (UTC)
- weekly: last 7 days including today (UTC)
- monthly: last 30 days including today (UTC)
- custom: inclusive window between start_date and end_date (YYYY-MM-DD)

## Response
- 200 OK body:
  {
    "range": "daily|weekly|monthly|custom",
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD",
    "buckets": [
      { "key": "YYYY-MM-DD", "label": "YYYY-MM-DD", "count": 0 }
    ]
  }
- Buckets are daily, contiguous over the window, and zero-filled for dates with no results.
- 400 on invalid range, missing/invalid custom dates, or missing tenant when required.
- 500 on unexpected errors.

## Sources
- interfaces/openapi.json
- src/routes/projects.summary.routes.js

This document serves as a confirmation that the OpenAPI spec accurately reflects the implemented API and can be used by frontend clients to integrate date-range filters and tenant scoping.
