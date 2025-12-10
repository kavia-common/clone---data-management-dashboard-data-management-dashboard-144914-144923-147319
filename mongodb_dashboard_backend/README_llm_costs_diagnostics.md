# LLM Costs Diagnostics

Quick checks for empty array issues when calling /api/llm-costs.

1) Ensure server mounted public route:
- app.js mounts: app.use('/api/llm-costs', require('./routes/llmCosts.public.routes'))

2) Basic call with query alias and no Authorization (dev):
curl -i "http://localhost:3001/api/llm-costs?organization_id=T0015&page=1&limit=10"

Expect:
- 200 OK
- x-effective-tenant present
- x-llm-filter includes $or on tenant aliases and timestamp window
- JSON envelope: { success: true, data: [...], meta: { page, limit, total } }

3) With header (preferred in dev):
curl -i -H "x-organization-id: T0015" "http://localhost:3001/api/llm-costs?page=1&limit=10"

4) Debug explain (optional):
DEBUG_LLMCOSTS_EXPLAIN=1 npm run dev
- Then check /api/llm-costs/diagnostics/last if available.

Notes:
- Default window is MAX_DAYS_WINDOW (90 days) if from/to omitted.
- limit > 200 returns 400.
- client-supplied tenant fields in filter are ignored; use header/query or JWT.
