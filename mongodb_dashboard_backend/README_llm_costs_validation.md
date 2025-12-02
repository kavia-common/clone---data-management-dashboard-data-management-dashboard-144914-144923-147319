# LLM Costs Listing and Validation

This document provides notes to validate LLM costs endpoints, especially GET /api/llm-costs listing which was optimized to prevent timeouts.

## GET /api/llm-costs (List - Tabular)

- Requires tenant scope (JWT tenant or x-organization-id header). Super-admin/T0000 bypass supported for all-tenant diagnostics.
- Supports:
  - Pagination: page (default 1), limit (default 50, max 200)
  - Sorting: sort in { timestamp, created_at, _id, total_cost } with optional '-' for desc (default -timestamp)
  - Filters (whitelisted): status, provider, llm_model, user_id, session_id, project_id, request_id
  - Date range: from, to (ISO strings) applied to timestamp or created_at
- Defaults to last 30 days when no from/to to avoid full scans.
- Response shape (enveloped):
  {
    "success": true,
    "data": [
      {
        "_id": "65f0...",
        "request_id": "req_123",
        "timestamp": "2025-01-12T08:43:10.120Z",
        "model": "gpt-4o-mini",
        "provider": "openai",
        "user_id": "user_1",
        "organization_id": "org_1",
        "tokens_in": 123,
        "tokens_out": 456,
        "cost_usd": 0.01234,
        "duration_ms": 842,
        "status": "success"
      }
    ],
    "meta": { "page": 1, "limit": 50, "total": 1234, "sort": "-timestamp" }
  }

### Sample curl

curl -sS -H "Authorization: Bearer <JWT>" \
  -H "x-organization-id: org_1" \
  "http://localhost:3001/api/llm-costs?page=1&limit=50&sort=-timestamp&from=2025-01-01T00:00:00Z&to=2025-01-31T23:59:59Z&filter=$(node -p 'JSON.stringify({provider:\"openai\"})')"

### Performance expectations
- The endpoint enforces indexed filters and projections; typical response time is well under 12s timeout.
- Uses index { tenant_id:1, timestamp:-1 } or { organization_id:1, timestamp:-1 } from the model, plus projection to minimize payload.

### HTTP headers
- X-Applied-Tenant: Resolved tenant id or "all-tenants"
- X-Default-Date-Window: "last-30-days" when applied
- X-Forced-Sort: "timestamp" when the server overrides an unsafe sort
- X-Query-Filter: Effective Mongo filter used
- X-Projection: "tabular-v1"
- X-Collection: Collection name ("llm-costs")

## Known fields in the collection
- timestamp, created_at (Date)
- llm_model (String), provider (String)
- total_cost (Number or String, currency symbol is sanitized when string)
- usage.tokens_input, usage.tokens_output OR tokens_in, tokens_out
- user_id, session_id, project_id, request_id
- tenant_id OR organization_id (tenant scope)
- duration_ms, status

Ensure at least one of timestamp/created_at exists for proper sorting.
