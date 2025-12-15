# CORS Notes (Projects Summary)

- Allowed origins include:
  - https://vscode-internal-36447-beta.beta01.cloud.kavia.ai:3000
  - http://localhost:3000
  - https://localhost:3000
- If using credentials (cookies/Authorization), ensure CORS_CREDENTIALS=true (default).
- CORS is applied before routes; permissive echo CORS runs after strict CORS for diagnostics without overriding credentials.

Quick checks:

Preflight:
curl -i -X OPTIONS \
  -H "Origin: https://vscode-internal-36447-beta.beta01.cloud.kavia.ai:3000" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: x-organization-id, content-type, authorization, accept, sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, referer, user-agent" \
  "http://localhost:8080/api/projects/summary?range=daily"

GET:
curl -i \
  -H "Origin: https://vscode-internal-36447-beta.beta01.cloud.kavia.ai:3000" \
  -H "x-organization-id: demo-tenant" \
  "http://localhost:8080/api/projects/summary?range=daily"
