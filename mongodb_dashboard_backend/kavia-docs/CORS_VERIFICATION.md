# CORS verification (manual)

You can verify preflight and simple GET to /api/projects/summary from the frontend dev origin.

Example curl simulating preflight from the preview React origin:
```
curl -i -X OPTIONS "http://localhost:3001/api/projects/summary" \
  -H "Origin: https://vscode-internal-36447-beta.beta01.cloud.kavia.ai:3000" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: x-organization-id, Content-Type, Authorization, Accept, sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform, Referer, User-Agent"
```

Expected:
- 204 No Content
- Access-Control-Allow-Origin set to the same origin
- Access-Control-Allow-Methods includes GET,POST,PUT,PATCH,DELETE,OPTIONS
- Access-Control-Allow-Headers includes the requested header list
- Access-Control-Allow-Credentials: true (when credentials are used)

Simple GET simulation:
```
curl -i "http://localhost:3001/api/projects/summary" \
  -H "Origin: https://vscode-internal-36447-beta.beta01.cloud.kavia.ai:3000" \
  -H "x-organization-id: org_demo"
```

If your frontend runs at http://localhost:3000, replace Origin header accordingly.
