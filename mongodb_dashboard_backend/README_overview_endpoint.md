# Overview Costs Endpoint Notes

The legacy analytics endpoint for LLM costs over-time has been removed:
- Removed: GET /api/analytics/llm-costs/over-time

Overview charts should use stable helpers or alternative analytics endpoints that remain supported (e.g., dashboard overview metrics or users active trend). If a costs-over-time visualization is still desired, implement it on the frontend using available list endpoints (/api/llm-costs) or add a new backend aggregation in the future under a different, stable contract.

Example: retrieving recent LLM cost records (tenant-scoped)
```
GET /api/llm-costs?limit=50&sort=-timestamp
Header: x-organization-id: <tenantId> (when JWT is not used)
```

## Performance notes for /api/llm-costs

Enable concise profiling:
- LLM_COSTS_PROFILE=true
- LLM_COSTS_QUERY_TIMEOUT_MS=8000 (soft server-side timeout guard)

Explain example:
```
db.getCollection('llm-costs')
  .find({ organization_id: 'T0015' }, { _id: 1 })
  .sort({ _id: -1 })
  .skip(0)
  .limit(10)
  .explain('executionStats')
```

Recommended indexes:
- db.getCollection('llm-costs').createIndex({ organization_id: 1, _id: -1 })
- db.getCollection('llm-costs').createIndex({ organization_id: 1, createdAt: -1, _id: -1 })
- db.getCollection('llm-costs').createIndex({ organization_id: 1, created_at: -1, _id: -1 })
- db.getCollection('llm-costs').createIndex({ 'users.user_id': 1 }, { sparse: true })

Join behavior:
- Enrichment joins users[].user_id (string UUID) to users._id (string) via a single batched $in fetch.
- Pagination and projection are applied before enrichment, keeping the query bounded.
