# Environment Notes for LLM Costs Endpoint Instrumentation

The GET /api/llm-costs route contains optional performance instrumentation:

- Set LLM_COSTS_DEBUG=true to include MongoDB explain() executionStats for both the find and the countDocuments paths in the response meta.debug payload, and to emit compact execution stats in headers.
- Set LLM_COSTS_ROUTE_TIMEOUT_MS=12000 (default) to adjust the route-level timeout guard that returns 408 if the handler exceeds the budget.
- Set DEFAULT_PAGE_LIMIT=50 (default) to change the default page size (capped at 200).

Recommendations for production:
- Keep LLM_COSTS_DEBUG=false by default to avoid overhead.
- Prefer client-provided date windows (?from, ?to) to reduce scanned keys.
- Page size should be <= 200.
- Ensure the following indexes are present on the llm-costs collection:
  - { tenant_id: 1, timestamp: -1 }
  - { tenant_id: 1, created_at: -1 }
  - { organization_id: 1, timestamp: -1 } (for legacy alias)
- Consider adding a precomputed normalizedTimestamp field and index { tenant_id: 1, normalizedTimestamp: -1 } to eliminate $or on date fields.
