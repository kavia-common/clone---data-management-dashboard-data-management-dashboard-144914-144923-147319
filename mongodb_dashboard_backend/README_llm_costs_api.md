# LLM Costs API - Listing Endpoint

This document explains how to use and validate GET /api/llm-costs.

- Path: /api/llm-costs
- Method: GET
- Security: Bearer JWT preferred. Without JWT (demo), provide x-organization-id header.
- Pagination: page (default 1), limit (default 50, max 200)
- Sorting: sort in { timestamp, _id, total_cost } with optional '-' for desc (default -timestamp)
- Filters (whitelisted): status, provider, llm_model, user_id, session_id, project_id, request_id
- Date range: ?from=ISO&to=ISO; applied only on the canonical field 'timestamp'. The server does NOT use created_at in predicates.

Sample:
curl -sS -H "Authorization: Bearer <JWT>" \
  -H "x-organization-id: org_1" \
  "http://localhost:3001/api/llm-costs?page=1&limit=50&sort=-timestamp&filter=$(node -p 'JSON.stringify({provider:\"openai\", status:\"success\"})')"

Response:
{
  "success": true,
  "data": [
    {
      "_id": "65f0...",
      "request_id": "req_123",
      "timestamp": "2025-01-12T08:43:10.120Z",
      "created_at": "2025-01-12T08:43:10.120Z",
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

Performance:
- Uses indexed filters and projection to keep response under the route timeout (default 12s).
- Time filtering is canonical: only 'timestamp' is used in the query predicate, enabling index use and avoiding $or on time fields.

Notes:
- If Authorization is provided, the tenant must match any provided header/query tenant; otherwise 403.
- Headers include x-effective-tenant, x-llm-filter, x-llm-projection, x-llm-sort, x-llm-page, x-llm-limit, and timing headers (x-llm-timing-...). There is no header indicating "$or used on time" since only timestamp is used in predicates.
