# Overview Module Notes

The following overview charts and their API endpoints were removed as part of cleanup:
- Sessions Trend
- Users over time
- Overall Features

Unrelated analytics remain available, such as:
- GET /api/analytics/llm-cost-by-agent
- Dashboard metrics: GET /api/dashboard/overview/metrics
- LLM Costs listing and hierarchy endpoints

If a future requirement reintroduces any of the above charts, implement them under a new stable contract and update the OpenAPI specification accordingly.
