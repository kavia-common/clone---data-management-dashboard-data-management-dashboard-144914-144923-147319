# Step 01.03 - LLM Costs Compound Index Verification and Explain Usage

Purpose
- Verify compound indexes exist and are used by GET /api/llm-costs queries to prevent COLLSCAN and 504s.

Indexes to verify (must exist on collection "llm-costs"):
- { tenant_id: 1, timestamp: -1 }
- { organization_id: 1, timestamp: -1 }

Where defined
- src/models/llmCosts.model.js declares both indexes.
- The list controller calls ensureLlmCostsIndexes() (src/models/llmCosts.indexes.js) which runs model.syncIndexes() at runtime, creating missing indexes when MONGOOSE_AUTO_INDEX=false.

Explain capture
- The list controller (src/controllers/llmCosts.list.controller.js) captures explain() for both find and count when DEBUG_LLMCOSTS_EXPLAIN=1.
- It also runs example explains for organization_id=T0015 with page=1, limit=10:
  - noDate: tenant filter only, default sort -timestamp
  - withDate: tenant filter + 7-day range on timestamp

Run verification

1) Start backend with explains enabled:
   DEBUG_LLMCOSTS_EXPLAIN=1 \
   DEBUG_LLMCOSTS_EXPLAIN_TIMEOUT_MS=600 \
   npm start

2) No date filter (organization_id=T0015, page=1, limit=10):
   curl -i -sS -H "x-organization-id: T0015" \
     "http://localhost:3001/api/llm-costs?page=1&limit=10"

   Confirm:
   - Response headers contain:
     x-llm-explain-find: captured
     x-llm-explain-count: captured
   - Body: meta.debug.explain.examples.noDate.find.usedIndexes contains organization_id_1_timestamp_-1 (or tenant_id_1_timestamp_-1)
   - Body: meta.debug.explain.examples.noDate.find.winningPlan indicates an IXSCAN-based plan (no COLLSCAN)

3) With date filter (7 days):
   curl -i -sS -H "x-organization-id: T0015" \
     "http://localhost:3001/api/llm-costs?page=1&limit=10&from=$(date -u -d '7 days ago' +%FT%TZ)"

   Confirm:
   - meta.debug.explain.examples.withDate.find.usedIndexes includes organization_id_1_timestamp_-1 (or tenant_id_1_timestamp_-1)
   - winningPlan indicates index usage; verify absence of COLLSCAN.

4) If a request fails or times out, fetch last diagnostics snapshot:
   curl -sS "http://localhost:3001/api/llm-costs/diagnostics/last" | jq .

Expected findings
- Both compound indexes exist and are used by the winning plan for the example queries.
- Summaries (nReturned, totalDocsExamined, totalKeysExamined, executionTimeMillis) are reasonable with the index in use.
- No COLLSCAN in summarized plans.

References
- README_llm_costs_diagnostics.md: detailed explain capture behavior and interpretation.
- README_llm_costs_api.md: endpoint usage and performance notes.
