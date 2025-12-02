# LLM Costs Endpoint Validation

This document describes manual validation steps and notes for the `/api/llm-costs` endpoint and how to avoid 504s.

Key behaviors (Dec 2025):
- Route-level timeout: default 12s (configurable via LLM_COSTS_ROUTE_TIMEOUT_MS). Handler returns 408 if exceeded to prevent upstream 504s.
- Default date window: when no explicit pagination (page/limit) and no date filter is provided, server applies last 30 days filter (header X-Default-Date-Window: last-30-days).
- Sane default pagination: when ?page is provided without &limit, server uses DEFAULT_PAGE_LIMIT (default 20, max 200) and sets header X-Default-Limit.
- Safe sort allow list: timestamp, created_at, _id, total_cost; defaults to -timestamp if missing or invalid (X-Forced-Sort header when forced).
- Tenant scoping: Use Authorization bearer JWT (preferred) or x-organization-id header for demo/testing. Any tenant fields in client filter are ignored; server enforces tenant.

Useful indexes:
- { tenant_id: 1, timestamp: -1 }
- { tenant_id: 1, created_at: -1 }
- { organization_id: 1, timestamp: -1 }
- Additional model indexes exist for project_id, session_id, etc.

Environment variables:
- LLM_COSTS_ROUTE_TIMEOUT_MS=12000
- DEFAULT_PAGE_LIMIT=20

Manual validation

1) Ensure backend is running and DB is connected (optional for speed tests)
- curl -s http://localhost:3001/api/health | jq

2) Sanity fetch with pagination and tenant
- curl -s "http://localhost:3001/api/llm-costs?page=1&limit=20&sort=-timestamp" -H "x-organization-id: T0015" | jq
Expect 200 with envelope: { "success": true, "data": [...], "meta": { "page": 1, "limit": 20, "total": N } }

3) Unpaginated fetch applies last-30-days window
- curl -i -s "http://localhost:3001/api/llm-costs?organization_id=T0015" | sed -n '1,15p'
Check headers contain X-Default-Date-Window: last-30-days and X-Applied-Tenant.

4) Invalid filter fails fast
- curl -s "http://localhost:3001/api/llm-costs?organization_id=T0015&filter={bad" | jq
Expect 400 with message "Invalid filter JSON".

5) Timeout behavior (optional)
Temporarily set a very low timeout to validate 408:
- export LLM_COSTS_ROUTE_TIMEOUT_MS=1
- curl -s "http://localhost:3001/api/llm-costs?organization_id=T0015&page=1&limit=10" | jq
Expect 408 with message indicating timeout.

Notes
- If authenticated (Authorization bearer), the tenant from JWT is enforced; conflicting tenant hints return 403 by other middlewares/controllers.
- For very large datasets, prefer pagination and include time filters to keep response under 2 seconds.
