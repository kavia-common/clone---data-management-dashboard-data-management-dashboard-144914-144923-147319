# CORS Notes (Projects & Users Summary)

- Allowed origins (explicit allowlist):
  - https://vscode-internal-36447-beta.beta01.cloud.kavia.ai:3000
  - http://localhost:3000
  - https://localhost:3000
- Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
- Access-Control-Allow-Headers includes (lowercase plus canonicalized forms):
  - x-organization-id, content-type, authorization, accept, sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, referer, user-agent
- Access-Control-Allow-Credentials: true (no "*" anywhere when credentials are used)
- CORS middleware order:
  1) Strict apiCors (with credentials) applied at app.use('/api', apiCors)
  2) Explicit OPTIONS handlers for /api/projects/summary and /api/users/summary
  3) Permissive echo CORS AFTER strict (for diagnostics only; does not override credentials)
  4) Routes mounted under /api
- Route handlers do not short-circuit responses without CORS; headers are already set by upstream middleware.

Quick verification:

Preflight (projects):
curl -i -X OPTIONS \
  -H "Origin: https://vscode-internal-36447-beta.beta01.cloud.kavia.ai:3000" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: x-organization-id, content-type, authorization, accept, sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, referer, user-agent" \
  "http://localhost:8080/api/projects/summary?range=daily&organization_id=b2c"

GET (projects):
curl -i \
  -H "Origin: https://vscode-internal-36447-beta.beta01.cloud.kavia.ai:3000" \
  -H "x-organization-id: b2c" \
  "http://localhost:8080/api/projects/summary?range=daily&organization_id=b2c"

Preflight (users):
curl -i -X OPTIONS \
  -H "Origin: https://vscode-internal-36447-beta.beta01.cloud.kavia.ai:3000" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: x-organization-id, content-type, authorization, accept, sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, referer, user-agent" \
  "http://localhost:8080/api/users/summary?range=daily&organization_id=b2c"

GET (users):
curl -i \
  -H "Origin: https://vscode-internal-36447-beta.beta01.cloud.kavia.ai:3000" \
  -H "x-organization-id: b2c" \
  "http://localhost:8080/api/users/summary?range=daily&organization_id=b2c"
