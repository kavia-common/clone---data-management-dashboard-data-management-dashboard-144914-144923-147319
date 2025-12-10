# LLM Costs Diagnostics

Quick checks and troubleshooting for /api/llm-costs, especially when seeing empty arrays.

1) Verify route is mounted
- app.js should mount: app.use('/api/llm-costs', require('./routes/llmCosts.public.routes')) or equivalent.
- If using the fallback controller, the endpoint returns an envelope: { success, data, meta } consistently.

2) Basic call with header (preferred in dev)
curl -i -H "x-organization-id: T0015" "http://localhost:3001/api/llm-costs?page=1&limit=10"

Expect:
- 200 OK
- No caching: Cache-Control: no-store, Pragma: no-cache
- x-effective-tenant present and equals T0015
- x-llm-filter shows an $and with $or across tenant aliases. Timestamp constraint only appears when from/to provided.
- JSON envelope: { success: true, data: [...], meta: { page, limit, total, sort, window? } }

3) Alternative with query alias (when header not used)
curl -i "http://localhost:3001/api/llm-costs?organization_id=T0015&page=1&limit=10"

4) Date window behavior (updated)
- No implicit/default window. If from/to are both absent, there is NO timestamp filter.
- If only one bound is provided, the other is clamped to MAX_DAYS_WINDOW (default 90 days).
- If both from and to are provided and the span exceeds MAX_DAYS_WINDOW, the server returns 400.
- Window headers (x-llm-window-from/to/applied) are included only when a window is active.

5) Tenant alias matching (expanded)
The server matches tenant across multiple fields (normalized to string):
- organization_id, tenant_id, orgId, tenantId, organizationId, tenant.tenant_id, details.tenant_id, metadata.tenant_id

6) Diagnostics headers
- x-llm-filter: Effective MongoDB filter (JSON)
- x-llm-projection: Projection (JSON)
- x-llm-sort: Sort (JSON)
- x-llm-page, x-llm-limit
- x-llm-primary-sample: Minimal sample document found via Mongoose for the tenant (if available)
- x-llm-fallback: "native" when native driver path is used
- x-llm-fallback-collection: Name of probed collection used
- x-llm-fallback-sample: Minimal sample document found via native driver for the tenant (if available)

7) Troubleshooting persistent empty arrays
- Confirm MONGODB_URI points to the dataset containing your tenant records.
- Verify correct collection name. You can set LLMCOSTS_COLLECTION_NAME to map the model/queries, e.g.:
  - export LLMCOSTS_COLLECTION_NAME=llm_costs
- Check that your tenant id is exactly correct (e.g., T0015), comparisons are string-based.
- Use header x-organization-id: T0015. If using Authorization/JWT with tenant, ensure there is no mismatch; JWT tenant overrides and conflicting headers result in 403.
- If using from/to, ensure the desired data falls within the window; otherwise, omit from/to to return all.

8) Debug explain (optional)
- If DEBUG_LLMCOSTS_EXPLAIN=1 is supported in your environment, enable and inspect:
  DEBUG_LLMCOSTS_EXPLAIN=1 npm run dev
- Then check any diagnostics endpoints available (if implemented) or utilize headers above.

Limit rules
- limit > 200 returns 400.

Client-provided tenant fields inside filter are ignored. Use header/query alias or JWT for tenant scope.
