# Overview Costs Endpoint Notes

The legacy analytics endpoint for LLM costs over-time has been removed:
- Removed: GET /api/analytics/llm-costs/over-time

Overview charts should use stable helpers or alternative analytics endpoints that remain supported (e.g., dashboard overview metrics or users active trend). If a costs-over-time visualization is still desired, implement it on the frontend using available list endpoints (/api/llm-costs) or add a new backend aggregation in the future under a different, stable contract.

Example: retrieving recent LLM cost records (tenant-scoped)
```
GET /api/llm-costs?limit=50&sort=-timestamp
Header: x-organization-id: <tenantId> (when JWT is not used)
```
