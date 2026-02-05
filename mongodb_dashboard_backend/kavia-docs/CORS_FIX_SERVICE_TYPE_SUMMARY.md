<!-- # CORS fix: /api/service-type/summary

This change aligns backend CORS behavior with `.project_manifest.yaml` env vars:

- `ALLOWED_ORIGINS`
- `ALLOWED_HEADERS`
- `ALLOWED_METHODS`
- `CORS_MAX_AGE`
- `CORS_CREDENTIALS` (defaults to `true` if unset)

It ensures the frontend origin like:

`https://vscode-internal-27924-beta.beta01.cloud.kavia.ai:3000`

is allowed to call:

`GET /api/service-type/summary?range=daily&tenant_id=...`

including when cookies/credentials are used.

Also updated `TRUST_PROXY` handling in `src/app.js` so `req.secure` and proxy-related behavior are correct in cloud preview deployments. -->
