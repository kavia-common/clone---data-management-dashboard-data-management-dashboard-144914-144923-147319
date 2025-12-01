# Manual Tests: /api/llm-costs tenant scoping

Goal: Ensure that GET /api/llm-costs returns actual data for organization_id=T0015 with pagination and correct headers.

Preconditions
- MONGODB_URI and (optionally) MONGODB_DB are set.
- Documents exist in the `llm-costs` (or `llm_costs`) collection with `organization_id: "T0015"`.

Steps
1) Basic paginated fetch
   curl -s -D - \
     -H "Authorization: Bearer ok" \
     -H "x-organization-id: T0015" \
     "http://localhost:3001/api/llm-costs?page=1&limit=10"

   Expect:
   - 200 OK
   - JSON: { data: [...], page:1, limit:10, total: >=0 }
   - Header X-Applied-Tenant: T0015

2) Diagnostics
   curl -s \
     -H "Authorization: Bearer ok" \
     -H "x-organization-id: T0015" \
     -H "x-admin-diagnostics: true" \
     "http://localhost:3001/api/llm-costs/_diagnostics"

   Expect: success true, total >= 0, sample array (<=5), indexes list present

3) Timeout fallback validation (optional)
   Set env LLM_COSTS_QUERY_TIMEOUT_MS=1 and retry step 1; expect minimal fallback page with note, not empty data unless no docs.

4) All tenants (Super Admin)
   Add header x-all-tenants:true and verify X-Applied-Tenant: all-tenants in response.
