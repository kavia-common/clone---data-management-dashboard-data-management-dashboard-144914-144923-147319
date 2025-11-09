# Backend (Express) - Dashboard API

- Default port: 3010 (configurable via PORT in .env; if your environment expects a specific port, set PORT accordingly)
- Host bind: 0.0.0.0 by default (configurable via HOST)
- Docs (Swagger UI): http://localhost:3010/docs (alias: http://localhost:3010/api-docs)
- OpenAPI JSON: http://localhost:3010/openapi.json (alias: http://localhost:3010/api-docs.json)

Quick start (development)
- cd data-management-dashboard-144914-144923/mongodb_dashboard_backend
- npm install
- npm run dev   # binds to 0.0.0.0:3001 with nodemon; dotenv is loaded programmatically (script provided in package.json)
- curl http://localhost:3010/health  # fast 200
- curl http://localhost:3010/api/health  # includes db state

Troubleshooting: "Port 3010 is already in use"
- The server logs: "[startup] Port 3010 is already in use." This means another instance is already running and listening on 0.0.0.0:3010.
- To confirm which process: 
  - macOS/Linux: lsof -i :3001 -sTCP:LISTEN -Pn
  - Or: ss -ltnp | grep :3001
- Stop the stale process or change PORT in your .env to another value (e.g., 3101) and re-run.

Environment defaults and .env
- The server defaults to HOST=0.0.0.0 and PORT=3001 when not set.
- MongoDB is optional for boot; DB-backed endpoints will report db=disconnected until MONGODB_URI is provided.
- See .env.example for all variables you can set locally/CI.

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
- All protected routes should use verifyAuth and requireTenant middlewares.
- For Mongoose-based CRUD, prefer buildTenantCrudController(Model) from src/controllers/crudFactory.tenant.js.
- For custom queries/aggregations, ensure every filter/pipeline starts with tenant_id from req.auth.tenantId.
- Sample endpoints: see src/routes/tenantSample.routes.js.

## Authentication and Password Hashing (v1 → v2 migration)

This backend implements a versioned password hashing strategy with per-organization salts.

- v1 (legacy): static salt from environment (SECRET_SALT/AUTH_TENANT_SALT/PASSWORD_SALT). Used only for verification of existing hashes.
- v2 (current): per-organization dynamic salt stored on each Tenant document (`orgSalt`), plus optional global pepper (`AUTH_PASSWORD_PEPPER` or `AUTH_PEPPER`). Preferred algorithm is Argon2id if the `argon2` package is available, falling back to `bcrypt` if available, then to Node.js `scrypt` as a last resort.

On-Login Migration:
- When a user with a v1 hash logs in successfully, their password will be re-hashed immediately with v2 and updated in the database (online migration).
- If a user document has no `password_hash`, we preserve backward compatibility and allow login (placeholder token), so existing users are not broken.

Tenant Salt:
- New tenants automatically receive an `orgSalt` (base64) on creation.
- If a legacy tenant is missing `orgSalt`, it is generated automatically upon signup/login/reset operations.

New endpoints:
- POST /api/auth/signup { organization_id, email, password } → creates/updates a user with v2 hash.
- POST /api/auth/login { organization_id, email, password } → verifies and migrates v1→v2 when needed.
- POST /api/auth/reset-password { organization_id, email, password } → sets a new v2 hash (demo only; add token validation for production).

Security notes:
- Do not expose salts/peppers or any secrets in logs.
- Use strong values for SECRET_SALT and AUTH_PASSWORD_PEPPER in production.
- For production, implement JWTs signed with `AUTH_JWT_SECRET` and proper RBAC checks.

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

# Example response:
# [
#   { "agent": "GenerateDescriptionAgent", "total_cost": 1.234567 },
#   { "agent": "SummarizeAgent", "total_cost": 0.447605 }
# ]
```

Response example (200):
[
  { "agent": "GenerateDescriptionAgent", "total_cost": 1.234567 },
  { "agent": "SummarizeAgent", "total_cost": 0.447605 }
]

Notes:
- The service auto-detects plausible collections (llm-costs, llm_costs, llm_cost, logs, events, interactions, agentLogs) and supports both a flat schema (agent_name|agent|tool + total_cost|cost) and an Agents[] array schema with fields "Agent Name" and "Total Cost".
- Missing/empty agent names fall back to "Unknown".
- The aggregation strips leading '$' and commas from cost values and safely parses them to numbers.
- The implementation handles malformed or missing values safely and returns [] when no data.
- See /docs for OpenAPI details.

## Analytics: Group by Agents (usage & costs)

GET /api/analytics/agents

Description:
Aggregates agent usage and costs across:
- session_tracking.agent_costs (embedded under session_tracking documents)
- llm_costs.agents (embedded under llm_costs documents)

It computes per-agent:
- total_cost
- total_usage (based on available usage/tokens/calls fields)
- session_count (distinct sessions from session_tracking)
- source_breakdown:
  - session_tracking: { cost, usage }
  - llm_costs: { cost, usage }

Query params:
- tenant_id: string (optional)
- project_id: string (optional)
- from: ISO date (optional; default last 30 days if neither from/to provided)
- to: ISO date (optional)
- limit: integer (default 50, max 200)
- offset: integer (default 0)

Response:
```
{
  "items": [
    {
      "agent_name": "Agent A",
      "total_cost": 12.345678,
      "total_usage": 1234,
      "session_count": 8,
      "source_breakdown": {
        "session_tracking": { "cost": 4.5, "usage": 500 },
        "llm_costs": { "cost": 7.845678, "usage": 734 }
      }
    }
  ],
  "total": 1,
  "meta": { "limit": 50, "offset": 0, "from": "...", "to": "...", "tenant_id": null, "project_id": null }
}
```

Notes:
- Date filters are applied defensively against multiple possible timestamp fields (last_updated, updatedAt, createdAt, session_start, timestamp, date).
- Costs parsed from strings with `$` prefix when necessary.
- Results sorted by total_cost desc before pagination.
