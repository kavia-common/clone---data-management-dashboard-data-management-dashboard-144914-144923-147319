# CORS Verification Guide

This guide helps reproduce and verify CORS behavior for the Dashboard backend, especially for `/api/projects/summary`.

Required allowed origins:
- https://vscode-internal-36447-beta.beta01.cloud.kavia.ai:3000
- http://localhost:3000

Preflight headers must include:
- Access-Control-Allow-Origin
- Access-Control-Allow-Methods
- Access-Control-Allow-Headers
- Access-Control-Allow-Credentials (only when credentials enabled)

Allowed headers include:
- x-organization-id, content-type, authorization, accept,
  sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, referer, user-agent

1) Preflight (OPTIONS) verification
Replace BACKEND_URL with your backend base (e.g., http://localhost:8080).

curl -i -X OPTIONS \
  -H "Origin: https://vscode-internal-36447-beta.beta01.cloud.kavia.ai:3000" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: x-organization-id, content-type, authorization, accept, sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, referer, user-agent" \
  "${BACKEND_URL}/api/projects/summary?range=daily"

Expect:
- 204 No Content
- Access-Control-Allow-Origin echoes the Origin (or exact value when credentials enabled)
- Access-Control-Allow-Methods includes GET,POST,PUT,PATCH,DELETE,OPTIONS
- Access-Control-Allow-Headers includes the requested headers
- Access-Control-Allow-Credentials: true (when credentials are enabled in security middleware)

2) Simple GET verification (no credentials)
curl -i \
  -H "Origin: https://vscode-internal-36447-beta.beta01.cloud.kavia.ai:3000" \
  -H "x-organization-id: demo-tenant" \
  "${BACKEND_URL}/api/projects/summary?range=daily"

Expect:
- 200 OK
- Access-Control-Allow-Origin present and matches Origin
- Vary: Origin present
- JSON body

3) GET with credentials (if frontend uses cookies or Auth)
Ensure CORS_CREDENTIALS=true in environment.

curl -i --cookie "session=demo" \
  -H "Origin: https://vscode-internal-36447-beta.beta01.cloud.kavia.ai:3000" \
  -H "x-organization-id: demo-tenant" \
  "${BACKEND_URL}/api/projects/summary?range=daily"

Expect:
- Access-Control-Allow-Origin = the specific Origin (no wildcard)
- Access-Control-Allow-Credentials: true

Diagnostics:
- The backend logs Origin and the resolved Access-Control-Allow-Origin for /api/* paths.
- For /api/projects/summary, permissive middleware also logs the effective ACAO.

Troubleshooting:
- If Origin is not allowed, confirm it appears in the [CORS] Whitelist log at startup.
- Check duplicate middlewares: strict CORS is applied first, permissive CORS after to avoid overriding credential headers.
- Ensure the request path starts with /api to pass through the configured CORS.
