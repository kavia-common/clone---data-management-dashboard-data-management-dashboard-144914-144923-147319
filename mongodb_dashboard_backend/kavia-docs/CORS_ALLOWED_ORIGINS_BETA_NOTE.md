# CORS env note (beta domain + vscode-internal frontend)

This backend is configured to use an **explicit allowlist** for credentialed CORS.

If Overview charts (e.g. `/api/service-type/summary`) fail with CORS errors after switching to the beta domain, ensure the backend environment includes **both**:

- The *frontend* origin (where the browser runs), e.g.
  - `https://vscode-internal-27924-beta.beta01.cloud.kavia.ai:3000`

- Any additional UI/API origins you expect to use directly, e.g.
  - `https://kavia-dashboard-kavia-beta.cloud.kavia.ai`

Recommended env:

- `CORS_CREDENTIALS=true`
- `ALLOWED_ORIGINS=https://vscode-internal-27924-beta.beta01.cloud.kavia.ai:3000,https://kavia-dashboard-kavia-beta.cloud.kavia.ai`
- `ALLOWED_METHODS=GET,POST,PUT,DELETE,PATCH,OPTIONS`
- `ALLOWED_HEADERS=x-organization-id,content-type,authorization,accept`

Notes:
- Credentials + cookies require a non-`*` Access-Control-Allow-Origin response, so origin echoing is expected.
- This backend also supports legacy vars (`CORS_ORIGINS`, `FRONTEND_ORIGIN`, etc.), but `ALLOWED_ORIGINS` is preferred.
