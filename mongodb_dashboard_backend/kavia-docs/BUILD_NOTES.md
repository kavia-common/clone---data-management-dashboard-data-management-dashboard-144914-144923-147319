# Backend build notes

- The reported "deprecated escape sequence" in `src/utils/stringFormatters.js` pertains to the frontend container (`mongodb_dashboard_frontend/src/utils/stringFormatters.js`), not the backend. No such file exists in the backend.
- React Hooks lint rules are disabled in backend `eslint.config.mjs` since the backend is Node/Express only. Warnings should not fail the backend build.
- For `/api/llm-costs`, indexes are ensured at startup and server enforces tenant-scoped filters. Pagination limit is capped at 200 by default to avoid timeouts on large datasets.
- Query diagnostics: responses set `X-Query-Duration` header and may set `X-Query-Cache: micro` when applicable. Check server logs for `[crudFactory.list:/api/llm-costs]` and `[startup] LLMCost indexes ensured` messages.
