# Overview Costs Endpoint Notes

The legacy analytics endpoint for LLM costs over-time has been removed:
- Removed: GET /api/analytics/llm-costs/over-time

Overview charts should use stable helpers or alternative analytics endpoints that remain supported (e.g., dashboard overview metrics or users active trend). If a costs-over-time visualization is still desired, implement it on the frontend using available list endpoints (/api/llm-costs) or add a new backend aggregation in the future under a different, stable contract.

Example: retrieving recent LLM cost records (tenant-scoped)
```
GET /api/llm-costs?limit=50&sort=-timestamp
Header: x-organization-id: <tenantId> (when JWT is not used)
```

## Performance and profiling for /api/llm-costs

Environment flags:
- LLM_COSTS_PROFILE=true
  - When set, GET /api/llm-costs (page=1) logs a compact explain('executionStats') line indicating keys/docs examined and the winning stage.
- LLM_COSTS_QUERY_TIMEOUT_MS=8000
  - Controls maxTimeMS for the MongoDB queries in /api/llm-costs and a soft server-side guard to avoid long enrichment/count phases.

Query behavior:
- Early sort+skip+limit uses the { organization_id: 1, _id: -1 } index (or {_id:-1} when unscoped).
- Projection is minimal: _id, organization_id, organization_name, organization_cost, users, projects/project, agents, createdAt/created_at/timestamp.
- Per-document user lookups are batched into a single users collection fetch with `{ _id: { $in: [...] } }` using string UUIDs (no ObjectId casting).
- Response preserves users[].user_cost and users[].projects and only adds users[].user.

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
- db.getCollection('llm-costs').createIndex({ organization_id: 1, timestamp: -1, _id: -1 })
- db.getCollection('llm-costs').createIndex({ 'users.user_id': 1 }, { sparse: true })

Join behavior:
- Enrichment joins users[].user_id (string UUID) to users._id (string) via a single batched $in fetch.
- Pagination and projection are applied before enrichment, keeping the query bounded.

Operational tips:
- If you hit timeouts, reduce `limit`, add an organization filter, or increase `LLM_COSTS_QUERY_TIMEOUT_MS` within safe bounds.
- Use page=1 with `LLM_COSTS_PROFILE=true` to capture plan sampling and verify index usage.
