# Overview Module Notes

The following overview charts and their API endpoints were removed as part of cleanup:
- Sessions Trend
- Users over time
- Overall Features

Unrelated analytics remain available, such as:
- GET /api/analytics/llm-cost-by-agent
- Dashboard metrics: GET /api/dashboard/overview/metrics
- LLM Costs listing and hierarchy endpoints

Important:
- The backend root path GET / has been explicitly disabled and returns 404. Clients must not call / with organization_id or tenant_id.
- Use only documented /api/* routes. See Swagger UI at /api-docs or JSON at /api-docs.json.

If a future requirement reintroduces any of the above charts, implement them under a new stable contract and update the OpenAPI specification accordingly.
