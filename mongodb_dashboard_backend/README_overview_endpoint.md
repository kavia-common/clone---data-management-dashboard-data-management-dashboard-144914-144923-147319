# Overview Costs Over Time Endpoint

This backend adds an analytics endpoint to power the Overview module's "Costs over time" chart.

- Route: GET /api/analytics/llm-costs/over-time
- Query:
  - granularity: day|week|month (default: day)
  - from, to: ISO date-time bounds (defaults to last 30 days)
- Tenant scoping: Enforced via JWT/header (x-organization-id); supports T0000 bypass consistent with other analytics routes.
- Response:
  {
    "labels": ["YYYY-MM-DD", ...],
    "datasets": [{ "label": "Total cost (USD)", "data": [number, ...] }],
    "meta": { "granularity": "day", "from": "...", "to": "..." }
  }

Aggregation details:
- Collection candidates: model 'llm-costs' by default; environment override via LLM_EVENTS_COLLECTION (comma-separated allowed).
- Date fields: prefer timestamp; fallback created_at; fallback updated_at.
- Cost fields: prefer total_cost (when USD or currency missing), fallback cost_usd, fallback cost (parses "$" prefixed strings).

```sh
curl -H "Authorization: Bearer <token>" -H "x-organization-id: org1" \
  "$API/api/analytics/llm-costs/over-time?granularity=day&from=2024-10-01&to=2024-10-31"
```
