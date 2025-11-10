# Backend (Express) - Dashboard API

- Default port: 3001 (configurable via PORT in .env)
- Host bind: 0.0.0.0 by default (configurable via HOST)
- Docs (Swagger UI): http://localhost:3001/api-docs (alias: http://localhost:3001/docs)
- OpenAPI JSON: http://localhost:3001/openapi.json (alias: http://localhost:3001/api-docs.json)

Quick start (development)
- cd data-management-dashboard-144914-144923/mongodb_dashboard_backend
- npm install
- npm run dev   # binds to 0.0.0.0:3001 with nodemon; dotenv is loaded programmatically
- curl http://localhost:3001/health  # fast 200
- curl http://localhost:3001/api/health  # includes db state

Important
- Do NOT run `npm run dev` from the frontend folder; it has no dev script and CI logs will show "Missing script: dev".
- Avoid `-r dotenv/config` in scripts; dotenv is required in src/server.js.

Environment example: see .env.example.

Dev routes
- Dev-only endpoints under /api/dev/* are mounted only when:
  - NODE_ENV is not 'production', OR
  - ALLOW_DEV_ROUTES is set to 'true'
- In production without ALLOW_DEV_ROUTES=true, these routes are not registered. A warning is logged at startup.

Health/readiness
- GET /health → Fast readiness (always 200) with `{ status: "ok", db: connected|connecting|disconnected, timestamp }`
- GET /api/health → Same payload; safe for monitoring
- Health responses are not cached (`Cache-Control: no-store`)

CORS
- Defaults allow localhost:3000.
- You can set FRONTEND_ORIGIN or CORS_ORIGINS or define REACT_APP_API_BASE_URL and we infer its origin.

Key route to verify:
- GET /api/users/active-trend (e.g., http://localhost:3001/api/users/active-trend)

Multi-tenant enforcement:
- All protected routes use verifyAuth (JWT) then requireTenant. Tenant is derived from JWT by default.
- For Mongoose-based CRUD, use buildCrudController(Model) which enforces tenant via req.tenantId.
- For custom queries/aggregations, ensure every filter/pipeline starts with tenant_id = req.tenantId (or org aliases via req.buildOrgFilter).

## Authentication (JWT) and Password Hashing (v1 → v2)

This backend implements a versioned password hashing strategy with per-organization salts, and JWT for API auth.

- v1 (legacy): static salt from environment (SECRET_SALT/AUTH_TENANT_SALT/PASSWORD_SALT). Verification-only.
- v2 (current): per-organization dynamic salt stored on each Tenant document (`orgSalt`), plus optional global pepper (`AUTH_PASSWORD_PEPPER` or `AUTH_PEPPER`). Preferred algorithm is Argon2id if the `argon2` package is available, falling back to `bcrypt`, then Node.js `scrypt`.

On-Login Migration:
- When a user with a v1 hash logs in successfully, their password is re-hashed with v2 and updated (online migration).
- If a user document has no `password_hash`, we allow login (placeholder) for compatibility.

Tenant Salt:
- New tenants automatically receive an `orgSalt` (base64). Missing orgSalt is generated on signup/login/reset.

Auth endpoints:
- POST /api/auth/signup { organization_id, email, password } → creates/updates a user with v2 hash.
- POST /api/auth/login { organization_id, email, password } → verifies and migrates v1→v2 when needed. Returns a JWT.
- POST /api/auth/reset-password { organization_id, email, password } → sets a new v2 hash (demo only; add token validation for production).

How to obtain a JWT and use it in Swagger UI:
1) Create or ensure a user exists for your tenant, then login:
   curl -s -X POST http://localhost:3001/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"organization_id":"org_123","email":"user@example.com","password":"secret"}'
   The response will include a field like { "token": "<JWT>" } (or similar based on implementation).
2) Open http://localhost:3001/api-docs, click the "Authorize" button (lock icon).
3) In the BearerAuth field, paste: Bearer <your-jwt-token>
4) Now "Try it out" on protected endpoints (e.g., GET /api/users) without passing x-organization-id; the tenant will be taken from your JWT.

Note:
- Protected endpoints in Swagger are annotated with the bearerAuth security scheme. Public endpoints under /api/auth/* do not require Authorization.

Security notes:
- Use a strong JWT secret in production: set JWT_SECRET or AUTH_JWT_SECRET.
- Do not expose salts/peppers or any secrets in logs.

## Analytics: LLM cost distribution by agent

GET /api/analytics/llm-cost-by-agent

Description:
- Aggregates the LLM costs collection by agent and sums total cost per agent.
- Returns a sorted array of objects: [{ agent: string, total_cost: number }], descending by total_cost.
- Values are rounded to 6 decimal places and returned as numbers (not strings).
- If no data exists, returns an empty array [].

Sample curl:
```bash
# Basic request
curl -s http://localhost:3001/api/analytics/llm-cost-by-agent | jq .
```

Response example (200):
[
  { "agent": "GenerateDescriptionAgent", "total_cost": 1.234567 },
  { "agent": "SummarizeAgent", "total_cost": 0.447605 }
]

Notes:
- The service auto-detects plausible collections (llm-costs, llm_costs, llm_cost, logs, events, interactions, agentLogs) and supports both a flat schema (agent_name|agent|tool + total_cost|cost) and an Agents[] array schema with fields "Agent Name" and "Total Cost".

## Analytics: Group by Agents (usage & costs)

GET /api/analytics/agents

Description:
Aggregates agent usage and costs across:
- session_tracking.agent_costs
- llm_costs.agents

Outputs totals and per-source breakdowns. See /api-docs for details.
