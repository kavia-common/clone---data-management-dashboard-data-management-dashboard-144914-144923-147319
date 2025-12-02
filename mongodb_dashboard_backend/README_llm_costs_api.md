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

Response (tabular with details):
{
  "success": true,
  "data": [
    {
      "_id": "65f0...",
      "request_id": "req_123",
      "session_id": "sess_9",
      "project_id": "proj_1",
      "timestamp": "2025-01-12T08:43:10.120Z",
      "created_at": "2025-01-12T08:43:10.120Z",
      "model": "gpt-4o-mini",
      "model_version": "2024-12-01",
      "provider": "openai",
      "provider_status": "ok",
      "user_id": "user_1",
      "organization_id": "org_1",
      "tenant_id": "org_1",
      "tokens_in": 123,
      "tokens_out": 456,
      "prompt": "Summarize ...",
      "completion": "Here is a summary ...",
      "cost_usd": 0.01234,
      "total_cost": 0.01234,
      "currency": "USD",
      "duration_ms": 842,
      "status": "success",
      "details": {
        "breakdown": {
          "prompt_tokens": 123,
          "completion_tokens": 456,
          "input_cost": 0.003,
          "output_cost": 0.00934
        },
        "breakdown_summary": {
          "tokens": { "prompt": 123, "completion": 456 },
          "costs": { "input": 0.003, "output": 0.00934 }
        },
        "metadata": { "route": "/chat.completions" },
        "raw": { "any_other_field": "value" }
      }
    }
  ],
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 1234,
    "sort": "-timestamp",
    "window": { "from": "2025-01-01T00:00:00.000Z", "to": "2025-01-12T08:43:10.120Z", "applied": "default" },
    "diagnostics": {
      "headers": {
        "x-effective-tenant": "T0015",
        "x-llm-filter": "{...}",
        "x-llm-projection": "{...}",
        "x-llm-sort": "{...}",
        "x-llm-timing-parsed-ms": "3",
        "x-llm-timing-built-ms": "1",
        "x-llm-timing-exec-ms": "22"
      }
    }
  }
}

Performance:
- Uses indexed filters and projection to keep response under the route timeout (default 12s).
- Time filtering is canonical: only 'timestamp' is used in the query predicate, enabling index use and avoiding $or on time fields.

Notes:
- If Authorization is provided, the tenant must match any provided header/query tenant; otherwise 403.
- Headers include x-effective-tenant, x-llm-filter, x-llm-projection, x-llm-sort, x-llm-page, x-llm-limit, and timing headers (x-llm-timing-...). There is no header indicating "$or used on time" since only timestamp is used in predicates.
