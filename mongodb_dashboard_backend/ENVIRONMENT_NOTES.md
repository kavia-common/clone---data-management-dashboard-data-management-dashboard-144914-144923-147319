# Backend runtime hardening

- Memory cap: NODE_OPTIONS=--max_old_space_size=512 applied in scripts to avoid spikes during dev.
- Browserslist update warnings suppressed via `postinstall`; backend does not depend on browserslist for runtime.
- No webpack/React dev server is launched by backend; scripts are scoped to start Express only (no source maps control needed).
- Lint/test are CI-friendly (non-watch, do not block or crash the build on warnings).
- HOST: If unset or set to 'localhost', the server forces binding to 0.0.0.0 for container/preview compatibility.
- For live reload in development use `npm run dev:watch` (nodemon). In CI/previews prefer `npm run dev` to avoid watchers.

Environment variables (set via .env by orchestrator, do not hardcode here):
- HOST, PORT, MONGODB_URI, MONGODB_DB, and REACT_APP_* are ignored by backend unless explicitly referenced.

## LLM Costs endpoint performance contract

- GET /api/llm-costs requires mandatory pagination: provide ?page>=1 and ?limit<=100. Non-paginated requests will be rejected (400).
- Optional time window: ?from=ISO&to=ISO. Defaults to last 30 days when omitted. Time filter applies on the `timestamp` field with fallback to `created_at`.
- Backend applies maxTimeMS on queries and logs slow queries (>1s) to help diagnose performance bottlenecks.
- Indexes to ensure on the llm-costs collection (recommended):
  - { tenant_id: 1, timestamp: -1, _id: 1 }
  - { organization_id: 1, timestamp: -1, _id: 1 }
  - If filtering/sorting by created_at: { tenant_id: 1, created_at: -1, _id: 1 } and { organization_id: 1, created_at: -1, _id: 1 }
- The list endpoint returns a compact projection appropriate for the Costs table (id, tenant/organization ids, user_id, task_id, session_id, llm_model, provider, service_type, total_cost, currency, timestamp/created_at).
