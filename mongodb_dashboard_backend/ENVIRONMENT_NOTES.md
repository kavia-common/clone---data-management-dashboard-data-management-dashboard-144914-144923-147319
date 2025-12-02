# Backend runtime hardening

- Memory cap: NODE_OPTIONS=--max_old_space_size=512 applied in scripts to avoid spikes during dev (increase with caution).
- Browserslist update warnings suppressed via `postinstall`; backend does not depend on browserslist for runtime.
- No webpack/React dev server is launched by backend; scripts are scoped to start Express only.
- Watchers:
  - Use `npm run dev` for stable node without watchers in constrained CI.
  - Use `npm run dev:watch` (nodemon) locally. nodemon ignores heavy dirs and disables polling.
- HOST: If unset or set to 'localhost', the server forces binding to 0.0.0.0 for container/preview compatibility.
- Timeouts:
  - keepAliveTimeout=120s and headersTimeout=125s configured on the HTTP server.
  - Early heartbeat headers every 10s if no response started (config HEARTBEAT_MS).
  - Route-level guard for /api/llm-costs set to 120s to avoid 504 under slow queries.
- Diagnostics:
  - Periodic memory logs every 30s (MEM_LOG_INTERVAL_MS).
  - Heap usage warnings at ~80% of configured limit.
- Tenant scoping:
  - For /api/llm-costs, the backend accepts x-organization-id header or query aliases (?tenant_id/organization_id) in demo-mode.
  - JWT tenant takes precedence when Authorization header is present.
- Recommended:
  - Prefer `npm run dev` in CI/previews for stability; use `npm run dev:watch` locally.

Environment variables (set via .env by orchestrator, do not hardcode here):
- MONGODB_URI: MongoDB connection string (required for DB operations)
- MONGODB_DB (optional), MONGOOSE_AUTO_INDEX (optional)
- HEARTBEAT_MS, MEM_LOG_INTERVAL_MS (optional diagnostics)
