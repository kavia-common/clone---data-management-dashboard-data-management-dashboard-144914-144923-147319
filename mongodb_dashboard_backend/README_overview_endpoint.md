# Overview Costs Endpoint Notes

The legacy analytics endpoint for LLM costs over-time has been removed:
- Removed: GET /api/analytics/llm-costs/over-time

Overview charts should use stable helpers or alternative analytics endpoints that remain supported (e.g., dashboard overview metrics or users active trend). If a costs-over-time visualization is still desired, implement it on the frontend using available list endpoints (/api/llm-costs) or add a new backend aggregation in the future under a different, stable contract.

Example: retrieving recent LLM cost records (tenant-scoped)
```
GET /api/llm-costs?limit=50&sort=-timestamp
Header: x-organization-id: <tenantId> (when JWT is not used)
```

Additional diagnostics for LLM Costs
- /api/llm-costs/_diagnostics (admin-only): Returns counts and a small sample by organization_id, plus current indexes. Useful to verify data and scoping issues (e.g., tenant T0015).
- Bypass toggles:
  - env LLM_COSTS_BYPASS_READINESS=true (attempt query even if quick ping fails)
  - header x-admin-bypass-llm-costs: true (superadmin only; per-request)
- Response headers:
  - X-LLM-Costs-Scan: INDEX | COLLSCAN (from internal explain() sampling)
  - X-Applied-Tenant: chosen tenant or all-tenants
