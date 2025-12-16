# LLMCosts Diagnostics

- Default collection name is `llm_costs`. Override via env:
  - LLMCOSTS_COLLECTION_NAME=llm_costs

- To verify data path when `/api/llm-costs` returns empty results:
  1. Call with x-organization-id header (or ?organization_id / ?tenant_id for demo).
  2. Inspect response headers:
     - x-effective-tenant: resolved tenant used
     - x-llm-probed-collection: collection probed by fallback
     - x-llm-tenant-matched: count of tenant-only matches
     - x-llm-total-matched: count with full filter (including date window)
     - x-llm-filter / x-llm-projection / x-llm-sort
  3. Ensure the date window (from/to) includes your data; default window is 90 days.

- Legacy hyphenated references are normalized to underscore in code. The API path `/api/llm-costs` remains supported and maps to the `llm_costs` collection.
