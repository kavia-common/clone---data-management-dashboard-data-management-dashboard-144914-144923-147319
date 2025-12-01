# Development runtime notes

- Port binding: backend binds to HOST=0.0.0.0 and PORT=3001. Ensure only one process listens on 3001.
- Dev start (low memory): use `npm run dev` which now starts a plain Node process without nodemon overhead.
  - Nodemon alternative if needed: `npm run dev:nodemon`.
- Keepalive: the server has a lightweight keepalive timer active by default (configurable with KEEPALIVE_INTERVAL_MS, default 30000).
- Health endpoints: `/health`, `/api/health`, `/healthz` return JSON with db status (db may be disconnected if MONGODB_URI is not set).
- No frontend dev server is started by the backend; the frontend should proxy requests to http://localhost:3001.

LLM costs API in development:

- The route `/api/llm-costs` is protected by verifyAuth and tenant scoping.
- To fetch data without real JWT in development:
  - Set environment variable `ALLOW_DEMO_AUTH=true` and provide a tenant via header `x-organization-id: <TENANT_ID>`, or
  - Provide a Bearer token with a payload containing tenant id claims (tenantId/tenant_id/organization_id).
- If MONGODB_URI is not configured, `/api/llm-costs` returns 503 (Database not configured).

Environment variables commonly used:

- PORT=3001
- HOST=0.0.0.0
- KEEPALIVE_INTERVAL_MS=30000
- ALLOW_DEMO_AUTH=true (for tokenless local/dev)
- AUTH_DEFAULT_TENANT=DEMO
- MONGODB_URI=mongodb+srv://...

LLM Costs tuning (optional)
- LLM_COSTS_QUERY_TIMEOUT_MS=12000   # main list query timeout (ms). Count uses a smaller cap.
- LLM_COSTS_BYPASS_READINESS=true    # attempt query when quick readiness ping fails (temporary bypass)
- LLM_EVENTS_COLLECTION=llm-costs    # analytics by-agent service preferred collection(s), comma-separated allowed

Operational tips
- Ensure the `llm-costs` collection exists (hyphenated). If your data uses `llm_costs` (underscored), the backend will auto-fallback.
- Ensure tenant values (e.g., T0015) are stored under `organization_id` for scoping.
