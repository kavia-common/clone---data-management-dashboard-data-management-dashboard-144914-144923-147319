# CORS Verification - Overview Module

Overview charts use:
- GET /api/projects/summary
- GET /api/users/summary
- (Legacy placeholder) GET /api/dashboard/overview/metrics (currently returns 404 by design)
- Additional analytics may include:
  - GET /api/users/active-trend (if wired in Overview)
  - GET /api/users/tenant-summary (if wired in Overview)

Global backend CORS configuration:
- corsMiddleware (security.js) registered early, whitelist includes:
  - https://vscode-internal-36447-beta.beta01.cloud.kavia.ai:3000
  - http://localhost:3000
  - https://localhost:3000
- permissiveCorsMiddleware echoes request Origin and sets:
  - Access-Control-Allow-Origin: <Origin>
  - Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS
  - Access-Control-Allow-Headers includes required: x-organization-id, content-type, authorization, accept, sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, referer, user-agent
  - Access-Control-Max-Age: 600
  - Vary: Origin
- OPTIONS preflight handled once for /api/*

Targeted preflight tests (Preview Origin)
1) Projects summary (preflight)
curl -i -X OPTIONS \
  -H "Origin: https://vscode-internal-36447-beta.beta01.cloud.kavia.ai:3000" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: x-organization-id, content-type, authorization, accept, sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, referer, user-agent" \
  "http://localhost:8080/api/projects/summary?range=daily&organization_id=T0000"

2) Projects summary (GET)
curl -i \
  -H "Origin: https://vscode-internal-36447-beta.beta01.cloud.kavia.ai:3000" \
  -H "x-organization-id: T0000" \
  "http://localhost:8080/api/projects/summary?range=daily&organization_id=T0000"

3) Users summary (preflight)
curl -i -X OPTIONS \
  -H "Origin: https://vscode-internal-36447-beta.beta01.cloud.kavia.ai:3000" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: x-organization-id, content-type, authorization, accept, sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, referer, user-agent" \
  "http://localhost:8080/api/users/summary?range=daily&organization_id=T0000"

4) Users summary (GET)
curl -i \
  -H "Origin: https://vscode-internal-36447-beta.beta01.cloud.kavia.ai:3000" \
  -H "x-organization-id: T0000" \
  "http://localhost:8080/api/users/summary?range=daily&organization_id=T0000"

Notes:
- If frontend uses credentials, set CORS_CREDENTIALS=true and ensure cookie/token handling; origins are non-wildcard.
- Ensure Overview frontend requests use the shared axios client and baseURL without duplicating /api.
